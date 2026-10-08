import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Dialog } from '../components/Dialog'
import { UserText } from '../components/UserText'

export interface StructureTopic {
  id: string
  number: string
  title: string
  items: string[]
  theme?: 'navy' | 'red' | 'amber' | 'green' | 'blue'
}

export type GuideLanguage = 'en' | 'th'

const DEFAULT_STRUCTURE_EN: StructureTopic[] = [
  {
    id: 'sec-1',
    number: '1',
    title: '1. Document Header & Control',
    theme: 'navy',
    items: [
      'Manual Code: Unique reference identifier (e.g., MAN-PLT-001)',
      'Title: Concise and clear manual title indicating task or machinery',
      'Revision No.: Version number (e.g., REV 01)',
      'Effective Date: Date the manual becomes effective',
      'Owner & Department: Author and responsible department',
    ],
  },
  {
    id: 'sec-2',
    number: '2',
    title: '2. Purpose & Scope',
    theme: 'navy',
    items: [
      'Purpose: Objective of this manual (e.g., standardize operations, safety, compliance)',
      'Scope: Applicable machinery, production lines, or departments',
      'Target Audience: Roles responsible for following this manual',
    ],
  },
  {
    id: 'sec-3',
    number: '3',
    title: '3. Safety & Precautions',
    theme: 'red',
    items: [
      'Required PPE: Safety glasses, cut-resistant gloves, safety shoes, ear protection',
      'Hazard Warning Signs: Pinch points, high voltage, hot surfaces, hazardous chemicals',
      'Emergency Procedures: Emergency stop (E-Stop) locations and LOTO (Lockout/Tagout)',
    ],
  },
  {
    id: 'sec-4',
    number: '4',
    title: '4. Standard Operating Procedures (SOP)',
    theme: 'blue',
    items: [
      'Preparation: Tooling, raw materials, parameter setup, pre-checks',
      'Sequential Steps: Clear step-by-step instructions (1-2-3)',
      'Visual Aids: Photographs, diagrams, and Good vs. No Good (NG) comparisons',
    ],
  },
  {
    id: 'sec-5',
    number: '5',
    title: '5. Troubleshooting Guide',
    theme: 'amber',
    items: [
      'Symptom Table: Common errors, unexpected stoppage, abnormal vibration',
      'Possible Causes: Dirty sensors, closed valves, loose cables',
      'Corrective Action: First-line recovery steps and escalation contacts',
    ],
  },
  {
    id: 'sec-6',
    number: '6',
    title: '6. References & Revision History',
    theme: 'green',
    items: [
      'Reference Documents: Daily check sheets, PM inspection forms',
      'Revision History: Summary of changes, dates, and sign-offs for each version',
    ],
  },
]

const DEFAULT_STRUCTURE_TH: StructureTopic[] = [
  {
    id: 'sec-1-th',
    number: '1',
    title: '1. ข้อมูลควบคุมเอกสาร (Document Header & Control)',
    theme: 'navy',
    items: [
      'Manual Code: รหัสเอกสารอ้างอิงเฉพาะ (เช่น MAN-PLT-001)',
      'Title: ชื่อคู่มือกระชับ ชัดเจน บ่งบอกงานหรือเครื่องจักร',
      'Revision No.: หมายเลขการแก้ไข (เช่น REV 01)',
      'Effective Date: วันที่เริ่มมีผลบังคับใช้',
      'Owner & Department: ผู้จัดทำและแผนกที่รับผิดชอบ',
    ],
  },
  {
    id: 'sec-2-th',
    number: '2',
    title: '2. วัตถุประสงค์และขอบเขต (Purpose & Scope)',
    theme: 'navy',
    items: [
      'วัตถุประสงค์ (Purpose): จัดทำเพื่ออะไร (เช่น ปฏิบัติงานถูกต้อง ปลอดภัย และได้มาตรฐาน)',
      'ขอบเขต (Scope): บังคับใช้กับเครื่องจักรใด, พื้นที่การผลิตใด หรือตำแหน่งใด',
      'ผู้รับผิดชอบ (Target Audience): ใครเป็นผู้ปฏิบัติตามคู่มือนี้',
    ],
  },
  {
    id: 'sec-3-th',
    number: '3',
    title: '3. ความปลอดภัยและข้อควรระวัง (Safety & Hazards)',
    theme: 'red',
    items: [
      'อุปกรณ์ป้องกัน PPE: แว่นตานิรภัย, ถุงมือกันบาด/สารเคมี, รองเท้าเซฟตี้',
      'ป้ายสัญลักษณ์เตือน: จุดหนีบ, ไฟฟ้าแรงสูง, พื้นที่ความร้อน, สารเคมีอันตราย',
      'ขั้นตอนฉุกเฉิน: การกดปุ่ม E-Stop และการตัดระบบพลังงาน (LOTO)',
    ],
  },
  {
    id: 'sec-4-th',
    number: '4',
    title: '4. ขั้นตอนการปฏิบัติงาน (Standard Operating Steps)',
    theme: 'blue',
    items: [
      'การเตรียมการ (Preparation): เครื่องมือ, วัตถุดิบ, และการตั้งค่าพารามิเตอร์',
      'ลำดับขั้นตอน 1-2-3 (Sequential Steps): คำสั่งสั้น ชัดเจน ไม่กำกวม',
      'ภาพถ่ายประกอบ (Visual Aids): จุดสำคัญ หรือภาพเปรียบเทียบ Good vs No Good (NG)',
    ],
  },
  {
    id: 'sec-5-th',
    number: '5',
    title: '5. การแก้ไขปัญหาเบื้องต้น (Troubleshooting)',
    theme: 'amber',
    items: [
      'ตารางอาการผิดปกติ (Symptom): เครื่องไม่หมุน, แรงดันตก, ชิ้นงานเป็นรอย',
      'สาเหตุที่เป็นไปได้ (Possible Cause): เซนเซอร์สกปรก, วาล์วปิด, สายหลุด',
      'วิธีแก้ไข (Corrective Action): แนวทางแก้ไขเบื้องต้น และบุคคลที่ต้องแจ้งเมื่อเกินขอบเขต',
    ],
  },
  {
    id: 'sec-6-th',
    number: '6',
    title: '6. เอกสารอ้างอิงและประวัติ (References & History)',
    theme: 'green',
    items: [
      'แบบฟอร์มบันทึก: เช่น Check sheet ประจำวัน / Preventive Maintenance Form',
      'ประวัติการแก้ไข (Revision History): สรุปสิ่งที่เปลี่ยนแปลงในแต่ละ Revision',
    ],
  },
]

interface ChecklistItem {
  id: string
  label: string
  desc: string
  checked: boolean
}

const CHECKLIST_EN: ChecklistItem[] = [
  { id: 'c1', label: 'Use Official Standard Template', desc: 'Download standard .docx or .xlsx template from Templates page for consistent formatting.', checked: false },
  { id: 'c2', label: 'Specify Clear Manual Code & Revision', desc: 'Ensure standard naming such as MAN-PLT-001 and Revision 01.', checked: false },
  { id: 'c3', label: 'Include Complete Visuals & Sequential Steps', desc: 'Key operations should have photographs, diagrams, or Good vs NG comparisons.', checked: false },
  { id: 'c4', label: 'Highlight Safety & PPE Requirements', desc: 'Mark hazard points, required personal protective equipment, and emergency actions.', checked: false },
  { id: 'c5', label: 'Provide Basic Troubleshooting Guidance', desc: 'Include symptoms, potential causes, and immediate corrective actions.', checked: false },
  { id: 'c6', label: 'Attach Both Source (Word) and Viewable (PDF)', desc: 'Facilitates fast viewing for readers and easy maintenance for authors in future revisions.', checked: false },
]

const CHECKLIST_TH: ChecklistItem[] = [
  { id: 'c1', label: 'ใช้ Template มาตรฐานของระบบ', desc: 'ดาวน์โหลดไฟล์ .docx หรือ .xlsx จากหน้า Templates เพื่อจัดฟอร์แมตที่ถูกต้อง', checked: false },
  { id: 'c2', label: 'ระบุรหัส Manual Code และ Revision Number ชัดเจน', desc: 'เช่น MAN-PLT-001 และ Revision 01', checked: false },
  { id: 'c3', label: 'มีภาพประกอบและคำอธิบายขั้นตอนครบถ้วน', desc: 'ทุกขั้นตอนสำคัญควรมีภาพถ่ายหรือไดอะแกรมประกอบเพื่อให้เข้าใจง่าย', checked: false },
  { id: 'c4', label: 'ระบุหัวข้อความปลอดภัย (Safety & PPE)', desc: 'เตือนจุดอันตราย ข้อควรระวัง และอุปกรณ์ป้องกันส่วนบุคคลที่ต้องสวมใส่', checked: false },
  { id: 'c5', label: 'มีแนวทาง Troubleshooting เบื้องต้น', desc: 'ตารางระบุอาการผิดปกติ สาเหตุ และวิธีแก้ไขเบื้องต้น', checked: false },
  { id: 'c6', label: 'แนบทั้งไฟล์ต้นฉบับ (Word) และไฟล์อ่าน (PDF)', desc: 'เพื่อความสะดวกในการอ่านของ Viewer และการแก้ไขในอนาคต', checked: false },
]

const TOC_STORAGE_KEY_EN = 'manual_guide_toc_structure_en_v2'
const TOC_STORAGE_KEY_TH = 'manual_guide_toc_structure_th_v2'
const LANG_STORAGE_KEY = 'manual_guide_language_preference_v2'

function loadSavedStructure(lang: GuideLanguage): StructureTopic[] {
  const key = lang === 'th' ? TOC_STORAGE_KEY_TH : TOC_STORAGE_KEY_EN
  const fallback = lang === 'th' ? DEFAULT_STRUCTURE_TH : DEFAULT_STRUCTURE_EN
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    // fallback
  }
  return fallback
}

function saveStructure(lang: GuideLanguage, items: StructureTopic[]) {
  const key = lang === 'th' ? TOC_STORAGE_KEY_TH : TOC_STORAGE_KEY_EN
  try {
    localStorage.setItem(key, JSON.stringify(items))
  } catch {
    // ignore
  }
}

export function WorkflowGuidePage() {
  const [lang, setLang] = useState<GuideLanguage>(() => {
    const saved = localStorage.getItem(LANG_STORAGE_KEY)
    return saved === 'th' ? 'th' : 'en' // Default English
  })

  const [structure, setStructure] = useState<StructureTopic[]>(() => loadSavedStructure(lang))
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() => (lang === 'th' ? CHECKLIST_TH : CHECKLIST_EN))
  const [activeSection, setActiveSection] = useState<'structure' | 'workflow' | 'naming' | 'checklist'>('structure')

  // Topic Editor Modal State
  const [editingTopic, setEditingTopic] = useState<StructureTopic | null>(null)
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [feedback, setFeedback] = useState('')

  function handleSwitchLang(newLang: GuideLanguage) {
    if (newLang === lang) return
    setLang(newLang)
    localStorage.setItem(LANG_STORAGE_KEY, newLang)
    const newStructure = loadSavedStructure(newLang)
    setStructure(newStructure)
    setChecklist(newLang === 'th' ? CHECKLIST_TH : CHECKLIST_EN)
    setEditingTopic(null)
    setIsAddingNew(false)
    setFeedback(newLang === 'en' ? 'Switched to English' : 'เปลี่ยนเป็นภาษาไทยเรียบร้อย')
  }

  function toggleCheck(id: string) {
    setChecklist(prev => prev.map(item => (item.id === id ? { ...item, checked: !item.checked } : item)))
  }

  function handleSaveTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const title = String(data.get('title') || '').trim()
    const number = String(data.get('number') || '').trim() || String(structure.length + 1)
    const theme = (data.get('theme') as StructureTopic['theme']) || 'navy'
    const itemsRaw = String(data.get('items') || '').trim()
    const items = itemsRaw
      .split('\n')
      .map(line => line.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean)

    if (!title) return

    if (editingTopic && !isAddingNew) {
      // Edit existing
      setStructure(prev => {
        const updated = prev.map(item => (item.id === editingTopic.id ? { ...item, number, title, theme, items } : item))
        saveStructure(lang, updated)
        return updated
      })
      setFeedback(lang === 'en' ? `Topic "${title}" updated successfully.` : `บันทึกการแก้ไขหัวข้อ "${title}" เรียบร้อย`)
    } else {
      // Add new
      const newTopic: StructureTopic = {
        id: `sec-${Date.now()}`,
        number,
        title,
        theme,
        items,
      }
      setStructure(prev => {
        const updated = [...prev, newTopic]
        saveStructure(lang, updated)
        return updated
      })
      setFeedback(lang === 'en' ? `New topic "${title}" added successfully.` : `เพิ่มหัวข้อใหม่ "${title}" เรียบร้อย`)
    }

    setEditingTopic(null)
    setIsAddingNew(false)
  }

  function handleDeleteTopic(id: string, title: string) {
    const confirmMsg = lang === 'en' ? `Are you sure you want to delete topic "${title}"?` : `คุณต้องการลบหัวข้อ "${title}" ใช่หรือไม่?`
    if (!window.confirm(confirmMsg)) return
    setStructure(prev => {
      const updated = prev.filter(t => t.id !== id)
      saveStructure(lang, updated)
      return updated
    })
    setFeedback(lang === 'en' ? `Topic "${title}" deleted.` : `ลบหัวข้อ "${title}" แล้ว`)
  }

  function handleResetDefault() {
    const confirmMsg =
      lang === 'en'
        ? 'Are you sure you want to reset Table of Contents to default outline?'
        : 'คุณต้องการรีเซ็ตโครงสร้างสารบัญกลับเป็นค่ามาตรฐานเริ่มต้นใช่หรือไม่?'
    if (!window.confirm(confirmMsg)) return
    const defaults = lang === 'th' ? DEFAULT_STRUCTURE_TH : DEFAULT_STRUCTURE_EN
    setStructure(defaults)
    saveStructure(lang, defaults)
    setFeedback(lang === 'en' ? 'Table of Contents reset to default outline.' : 'รีเซ็ตโครงสร้างสารบัญกลับเป็นค่ามาตรฐานแล้ว')
  }

  function handleCopyOutline() {
    const text = structure.map(s => `## ${s.title}\n` + s.items.map(i => `- ${i}`).join('\n')).join('\n\n')

    navigator.clipboard
      .writeText(text)
      .then(() => {
        setFeedback(
          lang === 'en' ? 'Table of contents copied to clipboard (Markdown outline).' : 'คัดลอกโครงสร้างสารบัญ (Markdown outline) ไปยังคลิปบอร์ดแล้ว'
        )
      })
      .catch(() => {
        setFeedback(lang === 'en' ? 'Unable to copy to clipboard.' : 'ไม่สามารถคัดลอกได้')
      })
  }

  const completedCount = checklist.filter(c => c.checked).length

  function getThemeBadgeClass(theme?: StructureTopic['theme']) {
    switch (theme) {
      case 'red':
        return 'bg-red-800 text-white'
      case 'amber':
        return 'bg-amber-600 text-white'
      case 'green':
        return 'bg-emerald-700 text-white'
      case 'blue':
        return 'bg-sky-700 text-white'
      case 'navy':
      default:
        return 'bg-blue-900 text-white'
    }
  }

  return (
    <>
      <div className="page-heading flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1>{lang === 'en' ? 'Manual Creation Workflow & Guidelines' : 'คู่มือขั้นตอนการจัดทำและโครงสร้างเนื้อหา (Guidelines)'}</h1>
          </div>
          <p>
            {lang === 'en'
              ? 'Standardized structure, customizable table of contents, and step-by-step authoring workflow for operational manuals.'
              : 'มาตรฐานโครงสร้างเนื้อหา สารบัญที่ปรับแต่งได้ และขั้นตอนการจัดทำคู่มือตั้งแต่ร่างจนถึงการเผยแพร่'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Language Switcher */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                lang === 'en' ? 'bg-blue-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
              onClick={() => handleSwitchLang('en')}
            >
              🇺🇸 English
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                lang === 'th' ? 'bg-blue-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
              onClick={() => handleSwitchLang('th')}
            >
              🇹🇭 ไทย
            </button>
          </div>

          <Link to="/templates" className="btn-secondary">
            <Icon name="template" size={18} />
            {lang === 'en' ? 'Browse Templates' : 'ดูแม่แบบ (Templates)'}
          </Link>
        </div>
      </div>

      {feedback && (
        <p role="status" className="mb-5 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{feedback}</span>
          <button type="button" aria-label="Dismiss notification" className="h-8 w-8 text-emerald-700 hover:text-emerald-900" onClick={() => setFeedback('')}>
            &times;
          </button>
        </p>
      )}

      {/* Navigation Tabs */}
      <div className="project-tabs mb-6 flex flex-wrap gap-2">
        <button
          className={`px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
            activeSection === 'structure' ? 'bg-blue-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
          onClick={() => setActiveSection('structure')}
        >
          {lang === 'en' ? '1. Table of Contents & Structure' : '1. สารบัญและโครงสร้างคู่มือ (Structure)'}
        </button>
        <button
          className={`px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
            activeSection === 'workflow' ? 'bg-blue-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
          onClick={() => setActiveSection('workflow')}
        >
          {lang === 'en' ? '2. Workflow & Role Responsibilities' : '2. วงจรการจัดทำและบทบาท (Workflow & Roles)'}
        </button>
        <button
          className={`px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
            activeSection === 'naming' ? 'bg-blue-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
          onClick={() => setActiveSection('naming')}
        >
          {lang === 'en' ? '3. Naming & Revision Rules' : '3. การตั้งชื่อและ Revision (Conventions)'}
        </button>
        <button
          className={`px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
            activeSection === 'checklist' ? 'bg-blue-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
          onClick={() => setActiveSection('checklist')}
        >
          {lang === 'en' ? '4. Pre-flight Checklist' : '4. เช็กลิสต์ก่อนส่งตรวจ (Pre-flight Checklist)'}
        </button>
      </div>

      {/* Section 1: Standard Table of Contents & Structure (Editable) */}
      {activeSection === 'structure' && (
        <div className="space-y-6">
          <section className="panel p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  {lang === 'en' ? 'Standard Manual Structure (Table of Contents)' : 'สารบัญโครงสร้างเนื้อหาในคู่มือมาตรฐาน (Table of Contents)'}
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  {lang === 'en'
                    ? 'Define and customize the mandatory sections of your operational manuals. You can edit, add, or delete topics.'
                    : 'กำหนดโครงสร้างและหัวข้อที่คู่มือต้องมี คุณสามารถเขียน เพิ่ม ลบ หรือแก้ไขหัวข้อและรายการย่อยได้ตามความเหมาะสม'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={handleCopyOutline}
                  title={lang === 'en' ? 'Copy Markdown outline to clipboard' : 'คัดลอกโครงสร้างสารบัญทั้งหมด'}
                >
                  <Icon name="copy" size={15} />
                  {lang === 'en' ? 'Copy Outline' : 'คัดลอกสารบัญ'}
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={handleResetDefault}
                  title={lang === 'en' ? 'Reset to default outline' : 'คืนค่าเป็นโครงสร้างมาตรฐานเริ่มต้น'}
                >
                  <Icon name="refresh" size={15} />
                  {lang === 'en' ? 'Reset Default' : 'คืนค่าเริ่มต้น'}
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={() => {
                    setIsAddingNew(true)
                    setEditingTopic({
                      id: '',
                      number: String(structure.length + 1),
                      title: '',
                      theme: 'navy',
                      items: [],
                    })
                  }}
                >
                  <Icon name="plus" size={15} />
                  {lang === 'en' ? 'Add Topic' : 'เพิ่มหัวข้อใหม่'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {structure.map((topic, idx) => (
                <div key={topic.id || idx} className="rounded-xl border border-slate-200 bg-slate-50/70 p-5 space-y-3 relative group flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${getThemeBadgeClass(topic.theme)}`}>
                          {topic.number || idx + 1}
                        </span>
                        <h3 className="font-semibold text-slate-900 break-words">{topic.title}</h3>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          aria-label={`Edit section ${topic.title}`}
                          className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-800 transition-colors"
                          onClick={() => {
                            setIsAddingNew(false)
                            setEditingTopic(topic)
                          }}
                        >
                          <Icon name="edit" size={15} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete section ${topic.title}`}
                          className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-700 transition-colors"
                          onClick={() => handleDeleteTopic(topic.id, topic.title)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </div>

                    <UserText as="ul" className="space-y-1.5 text-sm text-slate-600 list-disc list-inside mt-3">
                      {topic.items.map((item, iIndex) => (
                        <li key={iIndex} className="break-words leading-relaxed">
                          {item}
                        </li>
                      ))}
                    </UserText>
                  </div>

                  <div className="pt-3 mt-3 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-400">
                    <span>{topic.items.length} {lang === 'en' ? 'items' : 'ข้อย่อย'}</span>
                    <button
                      type="button"
                      className="text-blue-900 font-medium hover:underline text-xs"
                      onClick={() => {
                        setIsAddingNew(false)
                        setEditingTopic(topic)
                      }}
                    >
                      {lang === 'en' ? 'Edit Topic' : 'แก้ไขหัวข้อนี้'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {structure.length === 0 && (
              <div className="empty-state py-8 text-center">
                <p className="text-slate-500 text-sm">{lang === 'en' ? 'No topics defined yet.' : 'ยังไม่มีหัวข้อสารบัญ'}</p>
                <button type="button" className="btn-secondary mt-3" onClick={handleResetDefault}>
                  {lang === 'en' ? 'Reset Default' : 'คืนค่าเริ่มต้น'}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Section 2: Workflow Lifecycle & Roles */}
      {activeSection === 'workflow' && (
        <section className="panel p-6 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {lang === 'en' ? 'Manual Authoring Lifecycle & Role Matrix' : 'วงจรการจัดทำคู่มือและบทบาทหน้าที่ (Workflow & Roles)'}
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              {lang === 'en'
                ? 'Standardized 4-stage operational workflow structured for Developers, Business Analysts, Admins, and End Users:'
                : 'ขั้นตอนการทำงาน 4 ลำดับขั้นที่แบ่งความรับผิดชอบระหว่าง Dev, BA, Admin และ User อย่างชัดเจน:'}
            </p>
          </div>

          <figure className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="workflow-diagram-title">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 id="workflow-diagram-title" className="text-lg font-semibold text-slate-900">
                {lang === 'en' ? 'Manual Review & Publishing Workflow' : 'แผนภาพการตรวจ แก้ไข และเผยแพร่คู่มือ'}
              </h3>
              <a href="/images/manual-review-workflow.png" target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm">
                {lang === 'en' ? 'Open Full-size Diagram' : 'เปิดภาพขนาดเต็ม'}
              </a>
            </div>
            <a href="/images/manual-review-workflow.png" target="_blank" rel="noopener noreferrer"
              aria-label={lang === 'en' ? 'Open the workflow diagram at full size in a new tab' : 'เปิดแผนภาพ workflow ขนาดเต็มในแท็บใหม่'}
              className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-800">
              <img src="/images/manual-review-workflow.png" width={800} height={762} loading="lazy" decoding="async"
                className="mx-auto h-auto w-full max-w-[800px]"
                alt={lang === 'en'
                  ? 'Workflow diagram: Dev submits a draft to BA. BA approves, rejects with a reason for Dev to re-upload, or updates the same REV. Optional Dev feedback returns changes to BA, or lets BA approve and publish. Viewers read published manuals.'
                  : 'แผนภาพ workflow: Dev ส่งร่างให้ BA ตรวจ BA เลือก Approve, Reject พร้อมเหตุผลให้ Dev อัปโหลดใหม่ หรือ Update ใน REV เดิม หากส่งให้ Dev ตรวจร่วมและต้องแก้จะกลับไปหา BA หากผ่านแล้ว BA อนุมัติและเผยแพร่ให้ Viewer อ่าน'} />
            </a>
            <figcaption className="mt-4 text-sm leading-6 text-slate-600">
              {lang === 'en'
                ? 'Read from the top: log in, select an accessible Project, then follow your role. The diagram uses Thai labels; the explanations below describe each path in your selected language.'
                : 'อ่านจากบนลงล่าง: เข้าสู่ระบบ เลือก Project ที่มีสิทธิ์ แล้วทำตามเส้นทางของบทบาทตนเอง กดภาพหรือปุ่มเปิดภาพขนาดเต็มเพื่ออ่านข้อความในแต่ละขั้นตอน'}
            </figcaption>
          </figure>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">
              {lang === 'en' ? 'How to Follow the Review Paths' : 'คำอธิบายเส้นทางการตรวจเอกสาร'}
            </h3>
            <p className="text-sm leading-6 text-slate-600">
              {lang === 'en'
                ? 'Dev uploads the initial REV as DRAFT and selects Submit for Review. BA checks both the content and the attached files, then chooses one of the following actions.'
                : 'Dev อัปโหลด REV ครั้งแรกเป็น DRAFT แล้วกด Submit for Review เพื่อส่งให้ BA ตรวจทั้งเนื้อหาและไฟล์แนบ จากนั้น BA เลือกดำเนินการดังนี้'}
            </p>
            <dl className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <dt className="font-semibold text-emerald-900">Approve</dt>
                <dd className="mt-2 text-sm leading-6 text-slate-700">
                  {lang === 'en'
                    ? 'When the document is correct, BA approves it (APPROVED). BA / Admin then selects Publish to make it the current published revision.'
                    : 'เมื่อเอกสารถูกต้อง BA กด Approve เป็นสถานะ APPROVED จากนั้น BA / Admin กด Publish เพื่อให้เป็นฉบับเผยแพร่ปัจจุบัน'}
                </dd>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <dt className="font-semibold text-red-900">Reject</dt>
                <dd className="mt-2 text-sm leading-6 text-slate-700">
                  {lang === 'en'
                    ? 'BA must enter a rejection reason. Dev reads the feedback, corrects the document and uploads a new revision, then submits the new draft for review. The rejected file cannot be resubmitted unchanged.'
                    : 'BA ต้องระบุเหตุผลที่ไม่ผ่าน Dev อ่านข้อเสนอแนะ แก้ไขเอกสาร และอัปโหลด Revision ใหม่เป็น DRAFT แล้วส่งตรวจอีกครั้ง ไฟล์ที่ถูก Reject จะส่งตรวจซ้ำโดยไม่อัปโหลดใหม่ไม่ได้'}
                </dd>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <dt className="font-semibold text-blue-900">Update / Edit</dt>
                <dd className="mt-2 text-sm leading-6 text-slate-700">
                  {lang === 'en'
                    ? 'BA corrects the document and uploads replacement files in the same REV. It returns to DRAFT and records the update history. BA can approve directly or request Dev review first.'
                    : 'BA แก้ไขเอกสารเองและอัปโหลดไฟล์แทนใน REV เดิม เอกสารกลับเป็น DRAFT พร้อมบันทึกประวัติ BA เลือก Approve ได้โดยตรง หรือส่งให้ Dev ตรวจร่วมก่อน'}
                </dd>
              </div>
            </dl>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <p className="font-semibold text-slate-900">
                {lang === 'en' ? 'Optional Dev Review After a BA Update' : 'การให้ Dev ตรวจร่วมหลัง BA แก้ไข'}
              </p>
              <p className="mt-2">
                {lang === 'en'
                  ? 'If Dev review is not needed, BA approves the updated draft directly. If requested, Dev checks the latest files: Request Changes requires feedback and returns the document to BA for another update; No Further Changes means the document has passed and BA can approve directly. While Dev review is pending or changes remain unresolved, approval is unavailable.'
                  : 'หากไม่ต้องให้ Dev ตรวจ BA กด Approve จากร่างที่แก้แล้วได้เลย หากต้องตรวจ Dev จะอ่านไฟล์ล่าสุดและเลือก Request Changes พร้อมข้อเสนอแนะเพื่อให้ BA แก้เพิ่ม หรือ No Further Changes เมื่อเอกสารผ่านแล้ว BA จึงกด Approve ได้โดยตรง ระหว่างรอ Dev ตรวจหรือยังมีจุดที่ต้องแก้ จะยังอนุมัติไม่ได้'}
              </p>
              <p className="mt-2">
                {lang === 'en'
                  ? 'User / Viewer selects a published manual in an accessible Project to preview its PDF or download its files.'
                  : 'User / Viewer เลือกคู่มือฉบับเผยแพร่ใน Project ที่มีสิทธิ์ เพื่อ Preview PDF หรือ Download ไฟล์ไปใช้งาน'}
              </p>
            </div>
          </div>

          {/* Role Summary Badges */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50">
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <span className="inline-block rounded bg-amber-100 text-amber-900 px-2 py-0.5 text-xs font-bold">DEV (Developer)</span>
              <p className="text-xs text-slate-600 mt-2">
                {lang === 'en' ? 'Creates initial manual draft, uploads technical diagrams and steps, submits to BA for review.' : 'จัดทำร่างคู่มือเบื้องต้น (Initial Draft) แนบภาพและขั้นตอนทางเทคนิค ส่งต่อให้ BA ตรวจสอบ'}
              </p>
            </div>
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <span className="inline-block rounded bg-blue-100 text-blue-900 px-2 py-0.5 text-xs font-bold">BA (Business Analyst)</span>
              <p className="text-xs text-slate-600 mt-2">
                {lang === 'en' ? 'Sets templates and structure, reviews Dev drafts, edits full documentation, approves and publishes.' : 'กำหนด Template และสารบัญ ตรวจสอบร่างของ Dev แก้ไขฉบับสมบูรณ์ พร้อม Approve & Publish'}
              </p>
            </div>
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <span className="inline-block rounded bg-purple-100 text-purple-900 px-2 py-0.5 text-xs font-bold">ADMIN (Superuser)</span>
              <p className="text-xs text-slate-600 mt-2">
                {lang === 'en' ? 'Manages all users and roles, flushes system caches, performs data cleanups and project overrides.' : 'จัดการผู้ใช้และ Role ทั้งหมด ล้าง Cache ดูแลระบบส่วนกลาง และเข้าถึงทุกโปรเจกต์'}
              </p>
            </div>
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <span className="inline-block rounded bg-slate-100 text-slate-800 px-2 py-0.5 text-xs font-bold">USER (End User / Viewer)</span>
              <p className="text-xs text-slate-600 mt-2">
                {lang === 'en' ? 'Views and downloads officially published manuals for plant operations.' : 'เข้าดูและดาวน์โหลดคู่มือฉบับสมบูรณ์ (Published) เพื่อนำไปปฏิบัติตามมาตรฐาน'}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex gap-4 p-4 rounded-xl border border-slate-200 bg-amber-50/50">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-600 text-white font-bold">1</div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900">
                    {lang === 'en' ? 'Stage 1: Initial Draft Creation (DRAFT)' : 'ขั้นตอนที่ 1: จัดทำร่างคู่มือเบื้องต้น (DRAFT)'}
                  </h3>
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                    {lang === 'en' ? 'Actor: DEV / BA' : 'ผู้ทำ: DEV หรือ BA'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {lang === 'en'
                    ? 'Download standard template and create the manual draft following the Outline structure. Click "Upload New Revision", attach Word (.docx) or PDF, and specify revision changelog.'
                    : 'ดาวน์โหลด Template จากระบบ และเขียนเนื้อหาตามโครงสร้างสารบัญมาตรฐาน จากนั้นกด "Upload New Revision" โดยเลือกไฟล์ Word (.docx) หรือ PDF พร้อมระบุหมายเลข Revision และรายละเอียด'}
                </p>
              </div>
            </div>

            <div className="flex gap-4 p-4 rounded-xl border border-slate-200 bg-purple-50/50">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-600 text-white font-bold">2</div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900">
                    {lang === 'en' ? 'Stage 2: Submit for Review (SUBMIT)' : 'ขั้นตอนที่ 2: ส่งตรวจสอบ (SUBMIT FOR REVIEW)'}
                  </h3>
                  <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-900">
                    {lang === 'en' ? 'Actor: DEV / BA' : 'ผู้ทำ: DEV หรือ BA'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {lang === 'en'
                    ? 'Once draft verification is complete, click "Submit for Review". Status updates to IN_REVIEW for BA evaluation.'
                    : 'เมื่อตรวจทานไฟล์ร่างเรียบร้อยแล้ว กดปุ่ม "Submit for Review" สถานะเอกสารจะเปลี่ยนเป็น IN_REVIEW เพื่อรอการตรวจสอบจาก BA'}
                </p>
              </div>
            </div>

            <div className="flex gap-4 p-4 rounded-xl border border-slate-200 bg-sky-50/50">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-white font-bold">3</div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900">
                    {lang === 'en' ? 'Stage 3: Review, Full Edit & Approval (REVIEW)' : 'ขั้นตอนที่ 3: ตรวจสอบ แก้ไขฉบับเต็ม และอนุมัติ (REVIEW & APPROVE)'}
                  </h3>
                  <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900">
                    {lang === 'en' ? 'Actor: BA / Project Owner' : 'ผู้ทำ: BA หรือ Project Owner'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {lang === 'en'
                    ? 'BA reviews content, refines technical details, and makes approval decisions:'
                    : 'BA ตรวจสอบ Preview ความถูกต้องทางเทคนิคและปรับปรุงเนื้อหา:'}
                </p>
                <ul className="mt-2 space-y-1 text-sm text-slate-600 list-disc list-inside">
                  <li>
                    <strong>{lang === 'en' ? 'If Approved:' : 'หากถูกต้อง:'}</strong>{' '}
                    {lang === 'en'
                      ? 'Click "Approve". Status becomes APPROVED with full review audit trail.'
                      : 'กด "Approve" เอกสารจะเปลี่ยนเป็นสถานะ APPROVED พร้อมบันทึกประวัติการอนุมัติ'}
                  </li>
                  <li>
                    <strong>{lang === 'en' ? 'If Changes Needed:' : 'หากต้องแก้ไข:'}</strong>{' '}
                    {lang === 'en'
                      ? 'Click "Reject" with a required reason. Dev corrects the document, uploads a new revision, then submits it for review.'
                      : 'กด "Reject" พร้อมระบุเหตุผล ส่งกลับให้ Dev แก้ไขและอัปโหลด Revision ใหม่ แล้ว Submit for Review อีกครั้ง'}
                  </li>
                  <li>
                    <strong>{lang === 'en' ? 'Update / Edit:' : 'BA แก้ไขเอง (Update / Edit):'}</strong>{' '}
                    {lang === 'en'
                      ? 'BA replaces files and edits details in the same REV. The update returns to DRAFT and clears prior approval and Dev feedback. BA may approve directly or request Dev review.'
                      : 'BA แก้รายละเอียดและอัปโหลดไฟล์แทนใน REV เดิม เอกสารกลับเป็น DRAFT และต้องอนุมัติไฟล์ล่าสุดใหม่ BA กด Approve ได้เลย หรือเลือกส่งให้ Dev ตรวจร่วมก่อน'}
                  </li>
                  <li>
                    <strong>{lang === 'en' ? 'Dev review of BA updates:' : 'Dev ตรวจไฟล์ที่ BA แก้:'}</strong>{' '}
                    {lang === 'en'
                      ? 'Dev selects Request Changes with feedback, or No Further Changes. Changes return to BA Update/Edit; no further changes lets BA approve directly.'
                      : 'Dev เลือก Request Changes พร้อมข้อเสนอแนะเพื่อให้ BA แก้เพิ่ม หรือ No Further Changes เมื่อเอกสารผ่านแล้ว BA จึงกด Approve ได้โดยตรง'}
                  </li>
                </ul>
              </div>
            </div>

            <div className="flex gap-4 p-4 rounded-xl border border-slate-200 bg-emerald-50/50">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold">4</div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900">
                    {lang === 'en' ? 'Stage 4: Official Publishing (PUBLISH)' : 'ขั้นตอนที่ 4: เผยแพร่ใช้งานจริง (PUBLISH)'}
                  </h3>
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                    {lang === 'en' ? 'Actor: BA / Admin' : 'ผู้ทำ: BA หรือ Admin'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {lang === 'en'
                    ? 'BA or Admin clicks "Publish". This sets the revision as the Current Published Manual accessible and downloadable by all Users.'
                    : 'BA หรือ Admin กดปุ่ม "Publish" เพื่อตั้งค่าให้ Revision นี้เป็น Current Published Manual ที่ User ทั่วทั้งองค์กรสามารถเปิดอ่านและดาวน์โหลดได้ทันที'}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Section 3: Naming Conventions */}
      {activeSection === 'naming' && (
        <section className="panel p-6 space-y-6">
          <h2 className="text-xl font-bold text-slate-900">
            {lang === 'en' ? 'Code & Revision Naming Conventions' : 'มาตรฐานการตั้งรหัสและ Versioning'}
          </h2>
          <p className="text-sm text-slate-600">
            {lang === 'en'
              ? 'Consistent identifiers enable quick searchability and prevent operational mix-ups across plant lines:'
              : 'การกำหนดรหัสที่สอดคล้องกันช่วยให้ค้นหาเอกสารได้รวดเร็วและป้องกันความสับสนในสายการผลิต:'}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-5 py-3 font-semibold">{lang === 'en' ? 'Entity' : 'ประเภท'}</th>
                  <th className="px-5 py-3 font-semibold">{lang === 'en' ? 'Pattern Format' : 'รูปแบบ (Format)'}</th>
                  <th className="px-5 py-3 font-semibold">{lang === 'en' ? 'Example' : 'ตัวอย่าง'}</th>
                  <th className="px-5 py-3 font-semibold">{lang === 'en' ? 'Description' : 'คำอธิบาย'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-5 py-3.5 font-medium text-slate-900">Project Code</td>
                  <td className="px-5 py-3.5 font-mono text-xs text-blue-900 font-semibold">PRJ-[NAME]</td>
                  <td className="px-5 py-3.5 font-mono text-xs">PRJ-PLATING, PRJ-ASSEMBLY</td>
                  <td className="px-5 py-3.5 text-slate-600">
                    {lang === 'en' ? 'Uppercase project identifier with dashes' : 'รหัสโปรเจกต์ ตัวพิมพ์ใหญ่ ตัวเลข และขีดกลาง'}
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3.5 font-medium text-slate-900">Manual Code</td>
                  <td className="px-5 py-3.5 font-mono text-xs text-blue-900 font-semibold">[TYPE]-[PRJ]-[NO]</td>
                  <td className="px-5 py-3.5 font-mono text-xs">MAN-PLT-001, SOP-ASM-002</td>
                  <td className="px-5 py-3.5 text-slate-600">
                    {lang === 'en' ? 'Type prefix, project abbreviation, and 3-digit sequence' : 'รหัสคู่มือระบุประเภท ย่อโปรเจกต์ และลำดับตัวเลข'}
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3.5 font-medium text-slate-900">Revision No.</td>
                  <td className="px-5 py-3.5 font-mono text-xs text-blue-900 font-semibold">01, 02, 03...</td>
                  <td className="px-5 py-3.5 font-mono text-xs">01, 02, 1.0, 1.1</td>
                  <td className="px-5 py-3.5 text-slate-600">
                    {lang === 'en' ? 'Two-digit numeric sequence for exact chronological sorting' : 'เลขสองหลักเพื่อการเรียงลำดับที่แม่นยำ'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Section 4: Pre-flight Checklist */}
      {activeSection === 'checklist' && (
        <section className="panel p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {lang === 'en' ? 'Pre-flight Quality Checklist' : 'เช็กลิสต์ความสมบูรณ์ก่อนส่งอนุมัติ (Pre-flight Checklist)'}
              </h2>
              <p className="text-sm text-slate-600">
                {lang === 'en'
                  ? 'Verify key quality checks before submitting to avoid revision rejections:'
                  : 'ติ๊กตรวจสอบความครบถ้วนของเอกสารเพื่อลดโอกาสการถูก Reject:'}
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {lang === 'en' ? 'Progress' : 'ความคืบหน้า'}
              </span>
              <p className="text-lg font-bold text-blue-900">
                {completedCount} / {checklist.length} {lang === 'en' ? 'Passed' : 'ผ่าน'}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {checklist.map(item => (
              <label
                key={item.id}
                className={`flex items-start gap-4 p-4 rounded-xl border transition-colors cursor-pointer ${
                  item.checked ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <input type="checkbox" checked={item.checked} onChange={() => toggleCheck(item.id)} className="mt-1" />
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-sm ${item.checked ? 'text-emerald-950 line-through opacity-80' : 'text-slate-900'}`}>
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{item.desc}</p>
                </div>
                {item.checked && (
                  <span className="shrink-0 text-emerald-600 font-semibold text-xs inline-flex items-center gap-1">
                    <Icon name="check" size={14} /> {lang === 'en' ? 'Ready' : 'พร้อม'}
                  </span>
                )}
              </label>
            ))}
          </div>
        </section>
      )}

      {/* Edit/Add Topic Modal */}
      {editingTopic && (
        <Dialog
          title={
            isAddingNew
              ? lang === 'en'
                ? 'Add New Table of Contents Topic'
                : 'เพิ่มหัวข้อใหม่ในสารบัญ'
              : lang === 'en'
              ? 'Edit Topic'
              : 'แก้ไขหัวข้อสารบัญ'
          }
          onClose={() => setEditingTopic(null)}
        >
          <form onSubmit={handleSaveTopic}>
            <fieldset className="space-y-4 px-6 py-5">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <label className="field sm:col-span-1">
                  {lang === 'en' ? 'Order / Number' : 'ลำดับ / หมายเลข'}
                  <input name="number" defaultValue={editingTopic.number} placeholder={lang === 'en' ? 'e.g. 1 or A' : 'เช่น 1 หรือ A'} required />
                </label>
                <label className="field sm:col-span-3">
                  {lang === 'en' ? 'Section Title *' : 'ชื่อหัวข้อ (Section Title) *'}
                  <input
                    name="title"
                    defaultValue={editingTopic.title}
                    placeholder={lang === 'en' ? 'e.g. 1. Document Header & Control' : 'เช่น 1. ข้อมูลควบคุมเอกสาร (Document Header)'}
                    required
                    autoFocus
                  />
                </label>
              </div>

              <label className="field">
                {lang === 'en' ? 'Badge Color Theme' : 'โทนสีของป้ายกำกับ (Theme Badge)'}
                <select name="theme" defaultValue={editingTopic.theme || 'navy'}>
                  <option value="navy">Navy ({lang === 'en' ? 'Standard / General' : 'กรมท่า - มาตรฐาน'})</option>
                  <option value="blue">Blue ({lang === 'en' ? 'Procedures / Steps' : 'น้ำเงิน - ขั้นตอนงาน'})</option>
                  <option value="red">Red ({lang === 'en' ? 'Safety / Hazard' : 'แดง - ความปลอดภัย/อันตราย'})</option>
                  <option value="amber">Amber ({lang === 'en' ? 'Troubleshooting / Warning' : 'ส้ม - แก้ไขปัญหา/ข้อควรระวัง'})</option>
                  <option value="green">Green ({lang === 'en' ? 'References / Approval' : 'เขียว - เอกสารอ้างอิง/ตรวจรับ'})</option>
                </select>
              </label>

              <label className="field">
                {lang === 'en' ? 'Sub-items and Contents (1 line per item)' : 'รายการย่อยและเนื้อหาที่ต้องระบุ (1 บรรทัดต่อ 1 ข้อ)'}
                <textarea
                  name="items"
                  rows={5}
                  defaultValue={editingTopic.items.join('\n')}
                  placeholder={
                    lang === 'en'
                      ? 'Type items required in this section, each line is one sub-item...'
                      : 'พิมพ์รายการย่อยที่ต้องมีในหัวข้อนี้ แต่ละบรรทัดคือ 1 ข้อย่อย...'
                  }
                />
              </label>
            </fieldset>

            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setEditingTopic(null)}>
                {lang === 'en' ? 'Cancel' : 'ยกเลิก'}
              </button>
              <button type="submit" className="btn-primary">
                {lang === 'en' ? 'Save Topic' : 'บันทึกหัวข้อ'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  )
}
