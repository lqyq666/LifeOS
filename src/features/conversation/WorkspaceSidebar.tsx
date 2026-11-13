import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { WorkspaceIcon as Icon } from './WorkspaceIcon'
import type { Chat, Project, Workspace } from './workspace.ts'

type Menu = { kind: 'chat' | 'project'; id: string; move?: boolean }
type Edit = { kind: 'chat' | 'project' | 'new' | 'delete'; id: string; name: string; description: string }
type Props = {
  workspace: Workspace; busy: boolean; open: boolean; mobile: boolean; projectId: string | null
  onClose: () => void; onExit: () => void; onSelect: (id: string) => void; onProject: (id: string) => void
  onOpenCognition?: () => void
  onNew: (projectId?: string | null) => void; onChat: (id: string, patch: Partial<Chat>) => void
  onDelete: (id: string) => void
  onSaveProject: (id: string | null, name: string, description: string) => void
  accountConnected?: boolean
}

export function WorkspaceSidebar(props: Props) {
  const { workspace, busy, open, mobile, projectId, onClose, onExit, onOpenCognition=onExit, onSelect, onProject, onNew, onChat, onDelete, onSaveProject } = props
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [edit, setEdit] = useState<Edit | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const popup = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLButtonElement | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 220, maxHeight: 420 })
  function dismiss() { setMenu(null); setEdit(null); anchor.current?.focus({ preventScroll: true }) }
  function showMenu(event: MouseEvent<HTMLButtonElement>, next: Menu) {
    anchor.current = event.currentTarget
    setEdit(null); setMenu(menu?.kind === next.kind && menu.id === next.id ? null : next)
  }
  function showEdit(event: MouseEvent<HTMLButtonElement>, next: Edit) { anchor.current = event.currentTarget; setMenu(null); setEdit(next) }
  const sidebar = useRef<HTMLElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const editor = useRef<HTMLInputElement>(null)
  useEffect(() => { if (searchOpen) search.current?.focus() }, [searchOpen, open])
  useEffect(() => { if (!open || busy) { setMenu(null); setEdit(null) } }, [open, busy])
  useLayoutEffect(() => {
    if ((!menu && !edit) || !open || busy) return
    const box = popup.current!, trigger = anchor.current!
    box.showPopover()
    function place() {
      const rect = trigger.getBoundingClientRect(), viewport = window.visualViewport
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight
      if (!trigger.getClientRects().length || rect.bottom < y || rect.top > y + height) { setMenu(null); setEdit(null); return }
      const w = Math.min(edit ? 340 : 224, width - 16)
      const h = Math.min(box.scrollHeight + 2, height - 16)
      setPosition({ left: Math.max(x + 8, Math.min(rect.right - 12, x + width - w - 8)), top: Math.max(y + 8, Math.min(rect.bottom + 5, y + height - h - 8)), width: w, maxHeight: height - 16 })
    }
    const outside = (event: Event) => { if (!box.contains(event.target as Node) && event.target !== trigger && !trigger.contains(event.target as Node)) { setMenu(null); setEdit(null) } }
    const scrolled = (event: Event) => { if (!box.contains(event.target as Node)) place() }
    const resize = new ResizeObserver(place); resize.observe(box); resize.observe(trigger)
    place()
    if (edit && edit.kind !== 'delete') editor.current?.focus(); else box.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', scrolled, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      resize.disconnect(); document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', place); window.removeEventListener('scroll', scrolled, true)
      window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place)
      if (box.matches(':popover-open')) box.hidePopover()
    }
  }, [menu?.kind, menu?.id, menu?.move, edit?.kind, edit?.id, open, busy])
  useEffect(() => { if (open && mobile) sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus() }, [open, mobile])
  const chats = [...workspace.chats].sort((a, b) => b.updatedAt - a.updatedAt)
  const projects = workspace.projects
  const visible = query.trim() ? chats.filter(chat => (chat.title + ' ' + chat.conversation.messages.map(message => message.text).join(' ')).toLowerCase().includes(query.trim().toLowerCase())) : chats
  const pinned = chats.filter(chat => chat.pinned)
  const ungrouped = chats.filter(chat => !chat.pinned && (!chat.projectId || !projects.some(project => project.id === chat.projectId)))

  function save(event: FormEvent) {
    event.preventDefault()
    if (edit?.kind === 'delete') { onDelete(edit.id); dismiss(); return }
    if (!edit?.name.trim()) return
    if (edit.kind === 'chat') onChat(edit.id, { title: edit.name.trim(), renamed: true })
    else onSaveProject(edit.kind === 'new' ? null : edit.id, edit.name.trim(), edit.description.trim())
    dismiss()
  }
  function chatRow(chat: Chat, nested = false) {
    return <div key={chat.id} className={'qa-history-item' + (nested ? ' is-nested' : '')}>
      <div className="qa-history-line">
        <button type="button" className={'qa-history-link' + (chat.id === workspace.activeId && !projectId ? ' is-active' : '')} aria-current={chat.id === workspace.activeId && !projectId ? 'page' : undefined} disabled={busy} onClick={() => onSelect(chat.id)} title={chat.title}>
          {chat.pinned && <Icon name="pin" size={13} />}<span>{chat.title}</span>
        </button>
        <button type="button" className="qa-item-menu-trigger" aria-label={'管理对话：' + chat.title} aria-haspopup="menu" aria-expanded={menu?.kind === 'chat' && menu.id === chat.id} disabled={busy} onClick={event => showMenu(event, { kind: 'chat', id: chat.id })}><Icon name="more" size={16} /></button>
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
        <button type="button" className="qa-item-menu-trigger" aria-label={'管理项目：' + project.name} aria-haspopup="menu" aria-expanded={menu?.kind === 'project' && menu.id === project.id} disabled={busy} onClick={event => showMenu(event, { kind: 'project', id: project.id })}><Icon name="more" size={16} /></button>
      </div>
      {children.map(chat => chatRow(chat, true))}
    </div>
  }

  return <aside ref={sidebar} id="qa-sidebar" className="qa-sidebar" aria-label="对话与项目" hidden={!open} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (edit || menu) dismiss(); else onClose() }
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
      <button type="button" onClick={onOpenCognition}><Icon name="orbit" /><span>认知空间</span></button>
    </nav>
    {searchOpen && <div className="qa-sidebar-search"><input ref={search} aria-label="搜索对话" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题或内容" /></div>}
    <div className="qa-sidebar-scroll">
      {query.trim() ? <section className="qa-sidebar-section"><h2>搜索结果 <span>{visible.length}</span></h2>{visible.length ? visible.map(chat => chatRow(chat)) : <p className="qa-sidebar-empty">没有找到相符的对话。</p>}</section> : <>
        {!!pinned.length && <section className="qa-sidebar-section"><h2>置顶</h2>{pinned.map(chat => chatRow(chat))}</section>}
        <section className="qa-sidebar-section"><div className="qa-section-heading"><h2>项目</h2><button type="button" className="qa-icon-button" aria-label="创建项目" disabled={busy} onClick={event => showEdit(event, { kind: 'new', id: '', name: '', description: '' })}><Icon name="plus" size={16} /></button></div>
          {projects.length ? projects.map(projectRow) : <p className="qa-sidebar-empty">把同一件事的对话放在一起。</p>}
        </section>
        <section className="qa-sidebar-section"><h2>对话</h2>{ungrouped.length ? ungrouped.map(chat => chatRow(chat)) : <p className="qa-sidebar-empty">新对话会保存在这里。</p>}</section>
      </>}
    </div>
    {(menu || edit) && <div ref={popup} popover="manual" className="qa-sidebar-popup" style={position} role={edit ? 'dialog' : 'menu'} aria-label={edit ? (edit.kind === 'delete' ? '删除对话' : edit.kind === 'chat' ? '重命名对话' : edit.kind === 'new' ? '创建项目' : '编辑项目') : menu?.move ? '移至项目' : menu?.kind === 'chat' ? '对话操作' : '项目操作'} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (menu?.move) setMenu({ ...menu, move: false }); else dismiss(); return }
      if (!edit && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        const items = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }
      if (event.key === 'Tab') {
        if (!edit) { event.stopPropagation(); setMenu(null); return }
        const items = Array.from(popup.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea') ?? [])
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus() }
        event.stopPropagation()
      }
    }}>
      {edit ? <form className="qa-sidebar-editor" onSubmit={save}>
        <label htmlFor="qa-item-name">{edit.kind === 'delete' ? '删除对话？' : edit.kind === 'new' ? '创建项目' : edit.kind === 'project' ? '编辑项目' : '重命名对话'}</label>
        {edit.kind !== 'delete' && <input id="qa-item-name" ref={editor} aria-label={edit.kind === 'chat' ? '对话名称' : '项目名称'} maxLength={edit.kind === 'chat' ? 100 : 80} required value={edit.name} onChange={event => setEdit({ ...edit, name: event.target.value })} placeholder={edit.kind === 'chat' ? '对话名称' : '例如：毕业设计'} />}
        {(edit.kind === 'new' || edit.kind === 'project') && <textarea aria-label="项目说明" maxLength={500} rows={3} value={edit.description} onChange={event => setEdit({ ...edit, description: event.target.value })} placeholder="想在这个项目里做什么？（选填）" />}
        {edit.kind === 'delete' && <p className="qa-delete-explanation">将删除“{edit.name}”及其聊天记录。已保存到长期记忆和星图的资料会保留。</p>}
        <div><button type="button" onClick={dismiss}>取消</button><button type="submit" className={edit.kind === 'delete' ? 'is-danger' : undefined} disabled={busy || !edit.name.trim()}>{edit.kind === 'delete' ? '确认删除' : edit.kind === 'new' ? '创建' : '保存'}</button></div>
      </form> : null}

      {menu?.kind === 'chat' && (() => {
        const chat = chats.find(item => item.id === menu.id)
        if (!chat) return null
        if (menu.move) return <>
          <button type="button" role="menuitem" onClick={() => setMenu({ ...menu, move: false })}><Icon name="chevron" /><span>返回对话操作</span></button><div className="qa-popup-divider" />
          {[{ id: '', name: '未归类' }, ...projects].map(item => <button key={item.id} type="button" role="menuitemradio" aria-checked={(chat.projectId ?? '') === item.id} onClick={() => { onChat(chat.id, { projectId: item.id || null }); dismiss() }}><Icon name="folder" /><span>{item.name}</span>{(chat.projectId ?? '') === item.id && <Icon name="check" size={16} />}</button>)}
        </>
        return <>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); setEdit({ kind: 'chat', id: chat.id, name: chat.title, description: '' }) }}><Icon name="compose" /><span>重命名</span></button>
          <button type="button" role="menuitem" onClick={() => { onChat(chat.id, { pinned: !chat.pinned }); dismiss() }}><Icon name="pin" /><span>{chat.pinned ? '取消置顶' : '置顶'}</span></button>
          <div className="qa-popup-divider" />
          <button type="button" role="menuitem" aria-haspopup="menu" onClick={() => setMenu({ ...menu, move: true })}><Icon name="folder" /><span>移至项目</span><Icon name="chevron" size={15} /></button>
          <div className="qa-popup-divider" />
          <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenu(null); setEdit({ kind: 'delete', id: chat.id, name: chat.title, description: '' }) }}><Icon name="trash" /><span>删除</span></button>
        </>
      })()}
      {menu?.kind === 'project' && (() => {
        const project = projects.find(item => item.id === menu.id)
        return project ? <>
          <button type="button" role="menuitem" onClick={() => { dismiss(); onNew(project.id) }}><Icon name="compose" /><span>新建项目对话</span></button>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); setEdit({ kind: 'project', id: project.id, name: project.name, description: project.description }) }}><Icon name="folder" /><span>编辑项目</span></button>
        </> : null
      })()}
    </div>}
    <footer className="qa-sidebar-footer"><div><span className="qa-local-dot" />{props.accountConnected ? '对话已连接账户' : '示例保存在此浏览器'}</div></footer>
  </aside>
}
