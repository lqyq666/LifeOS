import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CodexSelect } from '../../components/ui/CodexSelect'
import { WorkspaceIcon as Icon } from './WorkspaceIcon'
import type { Chat, Project, Workspace } from './workspace.ts'

type Edit = { kind: 'chat' | 'project' | 'new'; id: string; name: string; description: string }
type Props = {
  workspace: Workspace; busy: boolean; open: boolean; mobile: boolean; projectId: string | null
  onClose: () => void; onExit: () => void; onSelect: (id: string) => void; onProject: (id: string) => void
  onNew: (projectId?: string | null) => void; onChat: (id: string, patch: Partial<Chat>) => void
  onSaveProject: (id: string | null, name: string, description: string) => void
  accountConnected?: boolean
}

export function WorkspaceSidebar(props: Props) {
  const { workspace, busy, open, mobile, projectId, onClose, onExit, onSelect, onProject, onNew, onChat, onSaveProject } = props
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [edit, setEdit] = useState<Edit | null>(null)
  const sidebar = useRef<HTMLElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const editor = useRef<HTMLInputElement>(null)
  useEffect(() => { if (searchOpen) search.current?.focus() }, [searchOpen, open])
  useEffect(() => { if (edit) editor.current?.focus() }, [edit?.id, edit?.kind])
  useEffect(() => { if (open && mobile) sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus() }, [open, mobile])
  const chats = [...workspace.chats].sort((a, b) => b.updatedAt - a.updatedAt)
  const projects = workspace.projects
  const visible = query.trim() ? chats.filter(chat => (chat.title + ' ' + chat.conversation.messages.map(message => message.text).join(' ')).toLowerCase().includes(query.trim().toLowerCase())) : chats
  const pinned = chats.filter(chat => chat.pinned)
  const ungrouped = chats.filter(chat => !chat.pinned && (!chat.projectId || !projects.some(project => project.id === chat.projectId)))

  function save(event: FormEvent) {
    event.preventDefault()
    if (!edit?.name.trim()) return
    if (edit.kind === 'chat') onChat(edit.id, { title: edit.name.trim(), renamed: true })
    else onSaveProject(edit.kind === 'new' ? null : edit.id, edit.name.trim(), edit.description.trim())
    setEdit(null)
  }
  function chatRow(chat: Chat, nested = false) {
    return <div key={chat.id} className={'qa-history-item' + (nested ? ' is-nested' : '')}>
      <div className="qa-history-line">
        <button type="button" className={'qa-history-link' + (chat.id === workspace.activeId && !projectId ? ' is-active' : '')} aria-current={chat.id === workspace.activeId && !projectId ? 'page' : undefined} disabled={busy} onClick={() => onSelect(chat.id)} title={chat.title}>
          {chat.pinned && <Icon name="pin" size={13} />}<span>{chat.title}</span>
        </button>
        <details className="qa-item-menu" onClick={event => event.stopPropagation()}>
          <summary aria-label={'管理对话：' + chat.title}><Icon name="more" size={16} /></summary>
          <div className="qa-menu-content">
              <button type="button" disabled={busy} onClick={event => { setEdit({ kind: 'chat', id: chat.id, name: chat.title, description: '' }); event.currentTarget.closest('details')?.removeAttribute('open') }}>重命名</button>
              <button type="button" disabled={busy} onClick={event => { onChat(chat.id, { pinned: !chat.pinned }); event.currentTarget.closest('details')?.removeAttribute('open') }}>{chat.pinned ? '取消置顶' : '置顶对话'}</button>
              <div className="qa-menu-project"><span>移至项目</span><CodexSelect label={'对话所属项目：' + chat.title} value={chat.projectId ?? ''} disabled={busy} onChange={value => onChat(chat.id, { projectId: value || null })} options={[{ value: '', label: '未归类' }, ...workspace.projects.map(project => ({ value: project.id, label: project.name }))]} /></div>
          </div>
        </details>
      </div>
    </div>
  }
  function projectRow(project: Project) {
    const children = chats.filter(chat => chat.projectId === project.id && !chat.pinned)
    return <div className="qa-project-group" key={project.id}>
      <div className="qa-history-line">
        <button type="button" className={'qa-project-link' + (projectId === project.id ? ' is-active' : '')} disabled={busy} onClick={() => onProject(project.id)} title={project.name}>
          <Icon name="folder" /><span>{project.name}</span><span className="qa-project-count">{workspace.chats.filter(chat => chat.projectId === project.id).length}</span>
        </button>
        <details className="qa-item-menu">
          <summary aria-label={'管理项目：' + project.name}><Icon name="more" size={16} /></summary>
          <div className="qa-menu-content">
            <button type="button" disabled={busy} onClick={() => onNew(project.id)}>新建项目对话</button><button type="button" disabled={busy} onClick={event => { setEdit({ kind: 'project', id: project.id, name: project.name, description: project.description }); event.currentTarget.closest('details')?.removeAttribute('open') }}>编辑项目</button>
          </div>
        </details>
      </div>
      {children.map(chat => chatRow(chat, true))}
    </div>
  }

  return <aside ref={sidebar} id="qa-sidebar" className="qa-sidebar" aria-label="对话与项目" hidden={!open} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (edit) setEdit(null); else onClose() }
    if (mobile && event.key === 'Tab') {
      const elements = Array.from(sidebar.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, summary') ?? []).filter(element => element.getClientRects().length)
      const first = elements[0], last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <div className="qa-sidebar-top"><button type="button" className="qa-sidebar-brand" onClick={onExit} aria-label="返回 LifeOS，恢复原位"><Icon name="orbit" size={23} /><span>LifeOS</span></button><button type="button" className="qa-icon-button" aria-label="收起侧边栏" onClick={onClose}><Icon name="panel" /></button></div>
    <nav className="qa-sidebar-actions" aria-label="工作区导航">
      <button type="button" disabled={busy} onClick={() => onNew()}><Icon name="compose" /><span>新对话</span><kbd>↗</kbd></button>
      <button type="button" onClick={() => { setSearchOpen(!searchOpen); setQuery('') }} aria-expanded={searchOpen}><Icon name="search" /><span>搜索对话</span></button>
      <button type="button" onClick={onExit}><Icon name="orbit" /><span>认知空间</span></button>
    </nav>
    {searchOpen && <div className="qa-sidebar-search"><input ref={search} aria-label="搜索对话" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题或内容" /></div>}
    <div className="qa-sidebar-scroll">
      {edit && <form className="qa-sidebar-editor" onSubmit={save}>
        <label htmlFor="qa-item-name">{edit.kind === 'new' ? '创建项目' : edit.kind === 'project' ? '编辑项目' : '重命名对话'}</label>
        <input id="qa-item-name" ref={editor} aria-label={edit.kind === 'chat' ? '对话名称' : '项目名称'} maxLength={edit.kind === 'chat' ? 100 : 80} required value={edit.name} onChange={event => setEdit({ ...edit, name: event.target.value })} placeholder={edit.kind === 'chat' ? '对话名称' : '例如：毕业设计'} />
        {edit.kind !== 'chat' && <textarea aria-label="项目说明" maxLength={500} rows={3} value={edit.description} onChange={event => setEdit({ ...edit, description: event.target.value })} placeholder="想在这个项目里做什么？（选填）" />}
        <div><button type="button" onClick={() => setEdit(null)}>取消</button><button type="submit" disabled={busy || !edit.name.trim()}>{edit.kind === 'new' ? '创建' : '保存'}</button></div>
      </form>}
      {query.trim() ? <section className="qa-sidebar-section"><h2>搜索结果 <span>{visible.length}</span></h2>{visible.length ? visible.map(chat => chatRow(chat)) : <p className="qa-sidebar-empty">没有找到相符的对话。</p>}</section> : <>
        {!!pinned.length && <section className="qa-sidebar-section"><h2>置顶</h2>{pinned.map(chat => chatRow(chat))}</section>}
        <section className="qa-sidebar-section"><div className="qa-section-heading"><h2>项目</h2><button type="button" className="qa-icon-button" aria-label="创建项目" disabled={busy} onClick={() => setEdit({ kind: 'new', id: '', name: '', description: '' })}><Icon name="plus" size={16} /></button></div>
          {projects.length ? projects.map(projectRow) : <p className="qa-sidebar-empty">把同一件事的对话放在一起。</p>}
        </section>
        <section className="qa-sidebar-section"><h2>对话</h2>{ungrouped.length ? ungrouped.map(chat => chatRow(chat)) : <p className="qa-sidebar-empty">新对话会保存在这里。</p>}</section>
      </>}
    </div>
    <footer className="qa-sidebar-footer"><div><span className="qa-local-dot" />{props.accountConnected ? '对话已连接账户' : '示例保存在此浏览器'}</div></footer>
  </aside>
}
