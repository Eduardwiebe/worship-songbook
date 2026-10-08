import { useI18n } from './i18n'
import { MIN_SHEET_ZOOM, MAX_SHEET_ZOOM } from './sheetZoom'

export function SheetZoomControls({ value, onChange }) {
  const { t } = useI18n()
  return <div className="tool-group sheet-zoom-tool">
    <span>{t('stageZoom.size')} · {value}%</span>
    <div className="sheet-zoom-controls">
      <button type="button" aria-label={t('stageZoom.smaller')} disabled={value <= MIN_SHEET_ZOOM} onClick={() => onChange(value - 5)}>−</button>
      <input type="range" aria-label={t('stageZoom.size')} aria-valuetext={`${value}%`} title={t('stageZoom.widthHint')} min={MIN_SHEET_ZOOM} max={MAX_SHEET_ZOOM} step="1" onPointerUp={(event) => event.currentTarget.blur()} value={value} onChange={(event) => onChange(event.target.value)}/>
      <button type="button" aria-label={t('stageZoom.larger')} disabled={value >= MAX_SHEET_ZOOM} onClick={() => onChange(value + 5)}>+</button>
      <button type="button" className="sheet-zoom-reset" title={t('stageZoom.widthHint')} onClick={() => onChange(100)}>100%</button>
    </div>
  </div>
}
