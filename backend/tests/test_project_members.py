import io
from pypdf import PdfWriter
import pytest

from app.auth import hash_password
from app.models.manual import Manual
from app.models.manual_revision import ManualRevision
from app.models.project import Project
from app.models.project_member import ProjectMember
from app.models.user import User


@pytest.fixture
def auth_users(context):
    client, db, storage = context
    from app.auth import get_current_user
    from app.main import app
    app.dependency_overrides.pop(get_current_user, None)
    users = {}
    for username, role in [
        ('admin', 'ADMIN'),
        ('owner', 'USER'),
        ('contributor', 'USER'),
        ('reviewer', 'USER'),
        ('viewer', 'USER'),
        ('outsider', 'USER'),
        ('extra_owner', 'USER'),
    ]:
        u = User(username=username, display_name=username.title(), role=role, password_hash=hash_password('Password123!'))
        db.add(u)
        users[username] = u
    db.commit()
    for u in users.values():
        db.refresh(u)
    return client, db, storage, users


def login(client, username):
    response = client.post('/api/auth/login', json={'username': username, 'password': 'Password123!'})
    assert response.status_code == 200
    client.headers['X-CSRF-Token'] = response.json()['csrf_token']
    return response.json()['user']


def make_pdf():
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.write(output)
    return output.getvalue()


def test_creator_becomes_owner(auth_users):
    client, db, _, users = auth_users
    login(client, 'owner')
    res = client.post('/api/projects', json={'project_code': 'PRJ-OWN', 'project_name': 'Owner Project'})
    assert res.status_code == 201
    project = res.json()
    assert project['owner_user_id'] == users['owner'].id
    assert project['my_role'] == 'OWNER'

    # Verify membership row created transactionally
    member = db.query(ProjectMember).filter_by(project_id=project['id'], user_id=users['owner'].id).one()
    assert member.role == 'OWNER'

    # GET members
    members = client.get(f'/api/projects/{project["id"]}/members').json()
    assert len(members) == 1
    assert members[0]['username'] == 'owner'
    assert members[0]['role'] == 'OWNER'


def test_project_delete_requires_owner_or_admin(auth_users):
    client, db, _, users = auth_users
    login(client, 'owner')
    project = client.post('/api/projects', json={'project_code': 'DELETE-ME', 'project_name': 'Delete Me'}).json()
    for role in ('viewer', 'contributor', 'reviewer'):
        db.add(ProjectMember(project_id=project['id'], user_id=users[role].id, role=role.upper()))
    db.commit()
    for username in ('viewer', 'contributor', 'reviewer', 'outsider'):
        login(client, username)
        assert client.delete(f'/api/projects/{project["id"]}').status_code in (403, 404)
    login(client, 'owner')
    assert client.delete(f'/api/projects/{project["id"]}').status_code == 200


def test_old_owners_migrated_to_owner(auth_users):
    client, db, _, users = auth_users
    # Simulate legacy project with owner_user_id
    proj = Project(project_code='PRJ-LEGACY-OWN', project_name='Legacy Owned', owner_user_id=users['owner'].id, created_by='owner')
    db.add(proj)
    db.commit()

    # Apply migration logic
    mem = ProjectMember(project_id=proj.id, user_id=users['owner'].id, role='OWNER', added_by=users['owner'].id)
    db.add(mem)
    db.commit()

    login(client, 'owner')
    res = client.get(f'/api/projects/{proj.id}')
    assert res.status_code == 200
    assert res.json()['my_role'] == 'OWNER'


def test_member_project_visibility_and_admin_sees_all(auth_users):
    client, db, _, users = auth_users
    login(client, 'owner')
    project = client.post('/api/projects', json={'project_code': 'PRJ-VIS', 'project_name': 'Visibility Project'}).json()

    # Add contributor and viewer
    assert client.post(f'/api/projects/{project["id"]}/members', json={'username': 'contributor', 'role': 'CONTRIBUTOR'}).status_code == 201
    assert client.post(f'/api/projects/{project["id"]}/members', json={'username': 'viewer', 'role': 'VIEWER'}).status_code == 201

    # Contributor sees P1 with my_role CONTRIBUTOR
    login(client, 'contributor')
    projects = client.get('/api/projects').json()
    assert len(projects) == 1
    assert projects[0]['id'] == project['id']
    assert projects[0]['my_role'] == 'CONTRIBUTOR'

    # Viewer sees P1 with my_role VIEWER
    login(client, 'viewer')
    projects = client.get('/api/projects').json()
    assert len(projects) == 1
    assert projects[0]['id'] == project['id']
    assert projects[0]['my_role'] == 'VIEWER'

    # Outsider sees 0 projects
    login(client, 'outsider')
    assert client.get('/api/projects').json() == []

    # Admin sees all projects
    login(client, 'admin')
    admin_projects = client.get('/api/projects').json()
    assert any(p['id'] == project['id'] for p in admin_projects)


def test_non_member_denied_and_idor_protection(auth_users):
    client, db, _, users = auth_users
    login(client, 'owner')
    project = client.post('/api/projects', json={'project_code': 'PRJ-IDOR', 'project_name': 'IDOR Project'}).json()
    manual = client.post(f'/api/projects/{project["id"]}/manuals', json={'manual_code': 'MAN-IDOR', 'title': 'IDOR Manual'}).json()
    pdf_data = make_pdf()
    rev = client.post(
        f'/api/manuals/{manual["id"]}/revisions',
        data={'revision_no': '01', 'revision_detail': 'Test'},
        files={'file': ('test.pdf', pdf_data, 'application/pdf')},
    ).json()

    # Outsider tries direct-ID access across all levels
    login(client, 'outsider')
    assert client.get(f'/api/projects/{project["id"]}').status_code == 404
    assert client.put(f'/api/projects/{project["id"]}', json={'project_name': 'Hacked'}).status_code == 404
    assert client.get(f'/api/projects/{project["id"]}/manuals').status_code == 404
    assert client.post(f'/api/projects/{project["id"]}/manuals', json={'manual_code': 'MAN-HACK', 'title': 'Hack'}).status_code == 404
    assert client.get(f'/api/projects/{project["id"]}/members').status_code == 404
    assert client.post(f'/api/projects/{project["id"]}/members', json={'username': 'outsider', 'role': 'OWNER'}).status_code == 404
    assert client.get(f'/api/manuals/{manual["id"]}').status_code == 404
    assert client.get(f'/api/manuals/{manual["id"]}/revisions').status_code == 404
    assert client.get(f'/api/manuals/{manual["id"]}/current').status_code == 404
    assert client.post(
        f'/api/manuals/{manual["id"]}/revisions',
        data={'revision_no': '02'},
        files={'file': ('hack.pdf', pdf_data, 'application/pdf')},
    ).status_code == 404
    assert client.get(f'/api/revisions/{rev["id"]}').status_code == 404
    assert client.get(f'/api/revisions/{rev["id"]}/preview').status_code == 404
    assert client.get(f'/api/revisions/{rev["id"]}/download').status_code == 404
    assert client.post(f'/api/revisions/{rev["id"]}/publish').status_code == 404


def test_viewer_is_read_only(auth_users):
    client, _, _, users = auth_users
    login(client, 'owner')
    project = client.post('/api/projects', json={'project_code': 'PRJ-VRO', 'project_name': 'Viewer Project'}).json()
    manual = client.post(f'/api/projects/{project["id"]}/manuals', json={'manual_code': 'MAN-VRO', 'title': 'Viewer Manual'}).json()
    pdf_data = make_pdf()
    rev = client.post(
        f'/api/manuals/{manual["id"]}/revisions',
        data={'revision_no': '01', 'revision_detail': 'Test'},
        files={'file': ('test.pdf', pdf_data, 'application/pdf')},
    ).json()
    client.post(f'/api/projects/{project["id"]}/members', json={'username': 'viewer', 'role': 'VIEWER'})

    login(client, 'viewer')
    # Allowed read operations
    assert client.get(f'/api/projects/{project["id"]}').status_code == 200
    assert client.get(f'/api/projects/{project["id"]}/manuals').status_code == 200
    assert client.get(f'/api/projects/{project["id"]}/members').status_code == 200
    assert client.get(f'/api/manuals/{manual["id"]}').status_code == 200
    assert client.get(f'/api/manuals/{manual["id"]}/revisions').status_code == 200
    assert client.get(f'/api/revisions/{rev["id"]}').status_code == 200
    assert client.get(f'/api/revisions/{rev["id"]}/preview').status_code == 200
    assert client.get(f'/api/revisions/{rev["id"]}/download').status_code == 200

    # Denied mutation operations (403)
    assert client.post(f'/api/projects/{project["id"]}/manuals', json={'manual_code': 'M2', 'title': 'M2'}).status_code == 403
    assert client.post(
        f'/api/manuals/{manual["id"]}/revisions',
        data={'revision_no': '02'},
        files={'file': ('v.pdf', pdf_data, 'application/pdf')},
    ).status_code == 403
    assert client.put(f'/api/projects/{project["id"]}', json={'project_name': 'Changed'}).status_code == 403
    assert client.post(f'/api/projects/{project["id"]}/members', json={'username': 'outsider', 'role': 'VIEWER'}).status_code == 403
    assert client.post(f'/api/revisions/{rev["id"]}/publish').status_code == 403


def test_contributor_upload_allowed(auth_users):
    client, _, _, users = auth_users
    login(client, 'owner')
    project = client.post('/api/projects', json={'project_code': 'PRJ-CONTR', 'project_name': 'Contributor Project'}).json()
    client.post(f'/api/projects/{project["id"]}/members', json={'username': 'contributor', 'role': 'CONTRIBUTOR'})

    login(client, 'contributor')
    # Creating manual allowed
    man = client.post(f'/api/projects/{project["id"]}/manuals', json={'manual_code': 'MAN-CONTR', 'title': 'Contributor Manual'})
    assert man.status_code == 201
    manual_id = man.json()['id']

    # Uploading revision allowed
    pdf_data = make_pdf()
    up = client.post(
        f'/api/manuals/{manual_id}/revisions',
        data={'revision_no': '01', 'revision_detail': 'Contributor upload'},
        files={'file': ('test.pdf', pdf_data, 'application/pdf')},
    )
    assert up.status_code == 201

    # Project settings / member management denied
    assert client.put(f'/api/projects/{project["id"]}', json={'project_name': 'Hacked'}).status_code == 403
    assert client.post(f'/api/projects/{project["id"]}/members', json={'username': 'outsider', 'role': 'VIEWER'}).status_code == 403


def test_owner_member_management(auth_users):
    client, _, _, users = auth_users
    login(client, 'owner')
    project = client.post('/api/projects', json={'project_code': 'PRJ-MGMT', 'project_name': 'Management Project'}).json()

    # Add member
    res = client.post(f'/api/projects/{project["id"]}/members', json={'username': 'viewer', 'role': 'VIEWER'})
    assert res.status_code == 201
    assert res.json()['username'] == 'viewer'
    assert res.json()['role'] == 'VIEWER'

    # Update role
    res = client.put(f'/api/projects/{project["id"]}/members/{users["viewer"].id}', json={'role': 'REVIEWER'})
    assert res.status_code == 200
    assert res.json()['role'] == 'REVIEWER'

    # Remove member
    res = client.delete(f'/api/projects/{project["id"]}/members/{users["viewer"].id}')
    assert res.status_code == 200
    assert res.json()['detail'] == 'Member removed'


def test_duplicate_member_rejected(auth_users):
    client, _, _, users = auth_users
    login(client, 'owner')
    project = client.post('/api/projects', json={'project_code': 'PRJ-DUP', 'project_name': 'Dup Project'}).json()

    # Owner already member
    res = client.post(f'/api/projects/{project["id"]}/members', json={'username': 'owner', 'role': 'VIEWER'})
    assert res.status_code == 409
    assert 'already a member' in res.json()['detail']


def test_last_owner_removal_and_demotion_rejected(auth_users):
    client, _, _, users = auth_users
    login(client, 'owner')
    project = client.post('/api/projects', json={'project_code': 'PRJ-LAST', 'project_name': 'Last Owner Project'}).json()

    # Demoting last owner rejected (409)
    res = client.put(f'/api/projects/{project["id"]}/members/{users["owner"].id}', json={'role': 'VIEWER'})
    assert res.status_code == 409
    assert 'Cannot demote the last OWNER' in res.json()['detail']

    # Removing last owner rejected (409)
    res = client.delete(f'/api/projects/{project["id"]}/members/{users["owner"].id}')
    assert res.status_code == 409
    assert 'Cannot remove the last OWNER' in res.json()['detail']

    # Add second owner
    assert client.post(f'/api/projects/{project["id"]}/members', json={'username': 'extra_owner', 'role': 'OWNER'}).status_code == 201

    # Now demoting one owner succeeds
    res = client.put(f'/api/projects/{project["id"]}/members/{users["extra_owner"].id}', json={'role': 'REVIEWER'})
    assert res.status_code == 200
    assert res.json()['role'] == 'REVIEWER'

    # Promote back and remove second owner succeeds
    assert client.put(f'/api/projects/{project["id"]}/members/{users["extra_owner"].id}', json={'role': 'OWNER'}).status_code == 200
    res = client.delete(f'/api/projects/{project["id"]}/members/{users["extra_owner"].id}')
    assert res.status_code == 200


def test_legacy_project_regression(auth_users):
    client, db, _, users = auth_users
    # Create legacy project without owner
    legacy = Project(project_code='LEGACY', project_name='Legacy Manuals', created_by='SYSTEM')
    db.add(legacy)
    db.commit()

    # Admin can access
    login(client, 'admin')
    assert client.get(f'/api/projects/{legacy.id}').status_code == 200

    # Non-admin cannot access (404)
    login(client, 'owner')
    assert client.get(f'/api/projects/{legacy.id}').status_code == 404
