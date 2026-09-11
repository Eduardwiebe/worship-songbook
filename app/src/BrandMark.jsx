/** Product mark: book+note icon (not company "L" letter). */
export function BrandMark({ className = 'brand-mark', size, alt = '', decorative = true }) {
  const style = size ? { width: size, height: size } : undefined
  return (
    <img
      className={className}
      src="/brand-icon.png"
      alt={decorative ? '' : alt || 'Songbook Band'}
      aria-hidden={decorative ? 'true' : undefined}
      style={style}
      draggable={false}
    />
  )
}
