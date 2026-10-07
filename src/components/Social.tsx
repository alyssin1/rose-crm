// Amigos (convite → aceite), participantes de tarefa e pedido de conclusão.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import type { Peer, Task } from '../lib/types'
import { Avatar, Icon } from './Icon'
import { Popover } from './Popover'
import { peerName, useFriendPeers } from './Sticky'

const peerOf = (peers: Peer[], id: string) => peers.find((p) => p.user_id === id)

/** Configurações → Amigos */
export function FriendsPanel() {
  const { t } = useTranslation()
  const data = useData()
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const me = data.userId
  const received = data.friends.filter((f) => f.status === 'pending' && f.addressee === me)
  const sent = data.friends.filter((f) => f.status === 'pending' && f.requester === me)
  const accepted = data.friends.filter((f) => f.status === 'accepted')
  const other = (f: { requester: string; addressee: string }) => peerOf(data.peers, f.requester === me ? f.addressee : f.requester)

  const invite = async () => {
    if (!email.trim()) return
    setBusy(true)
    const r = await data.inviteFriend(email)
    setBusy(false)
    setMsg(r === 'ok' ? t('friends.sent') : r === 'notfound' ? t('friends.notFound') : r === 'exists' ? t('friends.exists') : r)
    if (r === 'ok') setEmail('')
  }

  const person = (p: Peer | undefined, extra: React.ReactNode, key: string) => (
    <div className="friend-row" key={key}>
      <span className="peer-av lg"><Avatar url={p?.avatar_url} name={p ? peerName(p) : '?'} /></span>
      <div className="grow"><b>{p ? peerName(p) : '…'}</b><small>{p?.email}</small></div>
      {extra}
    </div>
  )

  return (
    <div className="settings-sec friends">
      <p className="friends-hint">{t('friends.hint')}</p>
      <div className="friend-invite">
        <input type="email" value={email} placeholder={t('friends.emailPh')} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void invite()} />
        <button className="btn-primary" disabled={busy || !email.trim()} onClick={() => void invite()}>{t('friends.invite')}</button>
      </div>
      {msg && <small className="friends-msg">{msg}</small>}

      {received.length > 0 && <h4>{t('friends.received')}</h4>}
      {received.map((f) => person(other(f), (
        <>
          <button className="btn-primary" onClick={() => void data.acceptFriend(f.id)}>{t('friends.accept')}</button>
          <button className="btn-ghost" onClick={() => void data.removeFriend(f.id)}>{t('friends.decline')}</button>
        </>
      ), f.id))}

      {sent.length > 0 && <h4>{t('friends.pending')}</h4>}
      {sent.map((f) => person(other(f), <button className="btn-ghost" onClick={() => void data.removeFriend(f.id)}>{t('friends.cancel')}</button>, f.id))}

      <h4>{t('friends.title')}</h4>
      {accepted.length === 0 && <small className="friends-msg">{t('friends.none')}</small>}
      {accepted.map((f) => person(other(f), <button className="btn-ghost" onClick={() => void data.removeFriend(f.id)}>{t('friends.remove')}</button>, f.id))}
    </div>
  )
}

/** Detalhe da tarefa: participantes (+ incluir amigo) e o aviso de pedido de conclusão. */
export function TaskPeople({ task }: { task: Task }) {
  const { t } = useTranslation()
  const data = useData()
  const friends = useFriendPeers()
  if (task.source === 'google') return null
  const me = data.userId
  const owner = task.user_id === me
  const ids = data.members.filter((m) => m.task_id === task.id).map((m) => m.user_id)
  const people = [task.user_id, ...ids]
  const free = friends.filter((p) => !people.includes(p.user_id))
  const req = task.close_request
  const asker = req ? peerOf(data.peers, req.by) : undefined

  return (
    <>
      {req && task.status === 0 && (
        <div className="close-req">
          <Icon name="checkSquare" size={16} />
          <div className="grow">
            {req.by === me ? t('friends.closeWaiting') : t('friends.closeAsk', { name: asker ? peerName(asker) : '' })}
          </div>
          {owner ? (
            <>
              <button className="btn-primary" onClick={() => void data.resolveClose(task, true)}>{t('friends.agree')}</button>
              <button className="btn-ghost" onClick={() => void data.resolveClose(task, false)}>{t('friends.disagree')}</button>
            </>
          ) : req.by === me ? (
            <button className="btn-ghost" onClick={() => void data.updateTask(task.id, { close_request: null })}>{t('friends.cancel')}</button>
          ) : null}
        </div>
      )}
      {(ids.length > 0 || (owner && friends.length > 0)) && (
        <div className="task-people">
          <span className="detail-label">{t('friends.people')}</span>
          <div className="people-list">
            {people.map((id) => {
              const p = id === me ? ({ user_id: me, display_name: data.profile?.display_name ?? null, avatar_url: data.profile?.avatar_url ?? null, email: null } as Peer) : peerOf(data.peers, id)
              return (
                <span key={id} className="person" title={p ? peerName(p) : ''}>
                  <span className="peer-av"><Avatar url={p?.avatar_url} name={p ? peerName(p) : '?'} /></span>
                  <span>{p ? peerName(p) : '…'}{id === task.user_id ? ` · ${t('friends.owner')}` : ''}</span>
                  {id !== task.user_id && (owner || id === me) && (
                    <button onClick={() => void data.removeMember(task.id, id)} aria-label={t('friends.remove')}><Icon name="x" size={11} /></button>
                  )}
                </span>
              )
            })}
            {owner && free.length > 0 && (
              <Popover trigger={(_o, toggle) => <button className="person add" onClick={toggle}><Icon name="plus" size={13} /> {t('friends.add')}</button>}>
                {(close) => (
                  <div className="menu">
                    {free.map((p) => (
                      <button key={p.user_id} onClick={() => { void data.addMember(task.id, p.user_id); close() }}>
                        <span className="peer-av"><Avatar url={p.avatar_url} name={peerName(p)} /></span> {peerName(p)}
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/** Linha da lista: avatares de quem divide a tarefa + aviso de pedido de conclusão. */
export function RowPeople({ task }: { task: Task }) {
  const { t } = useTranslation()
  const data = useData()
  const ids = data.members.filter((m) => m.task_id === task.id).map((m) => m.user_id)
  const others = [task.user_id, ...ids].filter((id) => id !== data.userId)
  if (!others.length && !task.close_request) return null
  return (
    <>
      {task.close_request && task.status === 0 && <span className="close-flag">{t('friends.closeFlag')}</span>}
      {others.length > 0 && (
        <span className="row-people">
          {others.slice(0, 3).map((id) => {
            const p = peerOf(data.peers, id)
            return <span key={id} className="peer-av sm" title={p ? peerName(p) : ''}><Avatar url={p?.avatar_url} name={p ? peerName(p) : '?'} /></span>
          })}
        </span>
      )}
    </>
  )
}
