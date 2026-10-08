"""Single backend password policy shared by user creation, admin reset and change-password."""
MIN_LENGTH = 12
MAX_LENGTH = 128


def validate_password(value):
    """Pydantic-compatible validator: returns the password unchanged or raises ValueError (never echoes it)."""
    if not isinstance(value, str):
        raise ValueError('Password must be text')
    if len(value) < MIN_LENGTH:
        raise ValueError(f'Password must be at least {MIN_LENGTH} characters')
    if len(value) > MAX_LENGTH:
        raise ValueError(f'Password must be at most {MAX_LENGTH} characters')
    if not value.strip():
        raise ValueError('Password must not be blank')
    return value
