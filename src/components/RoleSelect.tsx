interface RoleSelectProps {
  onSelect: (role: 'caller' | 'callee') => void
  error: string | null
}

/** ロール選択画面（idle / FR-01）。発信・応答の2ボタンを表示する。 */
export function RoleSelect({ onSelect, error }: RoleSelectProps) {
  return (
    <div className="role-select">
      <h1>WebRTC ビデオ通話</h1>
      <p className="hint">同じ WiFi につないだ2台で、QR を読み合って通話します。</p>
      <div className="role-buttons">
        <button type="button" className="primary" onClick={() => onSelect('caller')}>
          発信する
        </button>
        <button type="button" className="primary" onClick={() => onSelect('callee')}>
          応答する
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  )
}
