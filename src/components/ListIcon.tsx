// Ícone de lista: um ícone vetorial colorido (guardado como "icon:nome" no campo emoji, sem mudar o banco) ou um emoji.
import { Icon, type IconName } from './Icon'

export const ICON_PREFIX = 'icon:'
export const LIST_ICONS: IconName[] = [
  'list', 'folder', 'briefcase', 'home', 'cart', 'plane', 'book', 'graduation',
  'heart', 'star', 'dollar', 'music', 'camera', 'code', 'gift', 'dumbbell',
  'coffee', 'bulb', 'rocket', 'car', 'leaf', 'key', 'smile', 'target',
  'flame', 'chart', 'users', 'calendar', 'clock', 'note', 'globe', 'mail',
]

export const isIcon = (e?: string | null) => !!e && e.startsWith(ICON_PREFIX) && LIST_ICONS.includes(e.slice(ICON_PREFIX.length) as IconName)
export const iconValue = (n: IconName) => ICON_PREFIX + n
/** texto para lugares que só aceitam texto (ex.: <option>): ícones vetoriais viram vazio */
export const emojiText = (e?: string | null) => (!e || e.startsWith(ICON_PREFIX) ? '' : e)

export function ListIcon({ emoji, color, size = 18 }: { emoji?: string | null; color?: string | null; size?: number }) {
  if (!emoji) return null
  if (isIcon(emoji)) {
    return (
      <span className="list-ic" style={{ color: color ?? undefined }}>
        <Icon name={emoji.slice(ICON_PREFIX.length) as IconName} size={size} />
      </span>
    )
  }
  if (emoji.startsWith(ICON_PREFIX)) return null // ícone que não existe mais
  return <span className="emoji">{emoji}</span>
}
