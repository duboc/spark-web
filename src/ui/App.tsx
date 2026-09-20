import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AmpController } from '../state/amp.js'
import { diffPresets, slotDiff } from '../state/diff.js'
import { BleTransport, bluetoothAvailable } from '../transport/ble.js'
import { MockTransport } from '../transport/mock.js'
import { HARDWARE_PRESETS } from '../protocol/catalog.js'
import type { Preset } from '../protocol/preset.js'
import { SlotCard } from './SlotCard.js'
import { ChainStrip } from './ChainStrip.js'
import { Library } from './Library.js'
import { ProtocolLog } from './ProtocolLog.js'
import { looksLikePreset, pickJson, saveCapture, savePreset } from './files.js'

const amp = new AmpController()

export function App() {
  const snapshot = useSyncExternalStore(amp.subscribe, amp.getSnapshot)
  const [logOpen, setLogOpen] = useState(false)
  const [rawLog, setRawLog] = useState(false)
  const [storing, setStoring] = useState(false)
  const [draftName, setDraftName] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    amp.rawLogging = rawLog
  }, [rawLog])

  const connected = snapshot.status === 'connected'
  const live = snapshot.live

  // What you have changed since the preset was stored. Both sides are already in
  // memory, so this is a pure comparison rather than anything asked of the amp.
  const diff = useMemo(
    () => diffPresets(live, amp.storedForLive()),
    [live, snapshot.stored],
  )

  const connectBle = useCallback(() => void amp.connect(new BleTransport()), [])
  const connectMock = useCallback(() => void amp.connect(new MockTransport()), [])

  const send = useCallback((preset: Preset) => amp.uploadPreset(preset), [])

  const loadFromFile = useCallback(async () => {
    const data = await pickJson<Preset>('.json')
    if (!data) return
    if (!looksLikePreset(data)) {
      window.alert('That file is not a Spark preset.')
      return
    }
    amp.uploadPreset(data)
  }, [])

  // Dropping a preset file anywhere on the page sends it. A file is untrusted
  // input like anything else, so it is checked before it goes near the amp.
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      setDropping(true)
    }
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDropping(false)
    }
    const drop = (event: DragEvent) => {
      event.preventDefault()
      setDropping(false)
      const file = event.dataTransfer?.files[0]
      if (!file) return
      void file.text().then((text) => {
        try {
          const parsed: unknown = JSON.parse(text)
          if (looksLikePreset(parsed)) amp.uploadPreset(parsed)
          else window.alert(`${file.name} is not a Spark preset.`)
        } catch {
          window.alert(`${file.name} is not readable as JSON.`)
        }
      })
    }

    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  // Number keys switch presets, the way the four buttons on the amp do.
  useEffect(() => {
    if (!connected) return undefined
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const n = Number(event.key)
      if (Number.isInteger(n) && n >= 1 && n <= HARDWARE_PRESETS) {
        event.preventDefault()
        amp.selectPreset(n - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connected])

  const focusSlot = useCallback((slot: number) => {
    const card = document.getElementById(`slot-${slot}`)
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    card?.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true })
  }, [])

  const statusText = useMemo(() => {
    if (snapshot.status === 'connecting') return 'Connecting…'
    if (snapshot.status === 'connected') return snapshot.deviceName ?? 'Connected'
    return snapshot.error ?? 'Disconnected'
  }, [snapshot.status, snapshot.deviceName, snapshot.error])

  return (
    <>
      <header className="topbar">
        <h1 className="wordmark">
          SPARK <span>WEB</span>
        </h1>

        <div className="status">
          <span
            className={`lamp${connected ? ' on' : ''}${snapshot.status === 'connecting' ? ' busy' : ''}`}
          />
          <b>{statusText}</b>
          {snapshot.transportLabel && connected && <span>· {snapshot.transportLabel}</span>}
          {snapshot.queueDepth > 0 && <span>· {snapshot.queueDepth} queued</span>}
        </div>

        <span className="spacer" />

        {connected ? (
          <>
            <button type="button" onClick={() => amp.refresh()}>
              Reload state
            </button>
            <button type="button" onClick={() => void amp.disconnect()}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={connectMock}>
              Try without an amp
            </button>
            <button type="button" className="primary" onClick={connectBle} disabled={!bluetoothAvailable()}>
              Connect
            </button>
          </>
        )}
      </header>

      <main>
        {!live && <Welcome />}

        {live && (
          <>
            <div className="presets">
              {Array.from({ length: HARDWARE_PRESETS }, (_, slot) => (
                <button
                  key={slot}
                  type="button"
                  className={`preset${snapshot.currentPreset === slot ? ' active' : ''}`}
                  onClick={() => amp.selectPreset(slot)}
                >
                  <span className="n">PRESET {slot + 1}</span>
                  <span className="name">{snapshot.stored[slot]?.name ?? '—'}</span>
                </button>
              ))}
            </div>

            <ChainStrip pedals={live.pedals} diff={diff} onSelect={focusSlot} />

            <div className="toolbar">
              <input
                className="namefield"
                value={draftName ?? live.name}
                aria-label="Preset name"
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={() => {
                  if (draftName !== null) amp.renameLive(draftName)
                  setDraftName(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') setDraftName(null)
                }}
              />

              {/* The amp cannot tell you how far the live sound has drifted from
                  the preset it came from. This can, because it holds both. */}
              {diff.count > 0 && (
                <span
                  className="changes"
                  title={
                    `The live sound differs from stored preset ${(diff.against ?? 0) + 1} in ` +
                    `${diff.count} place${diff.count === 1 ? '' : 's'}. Storing to that slot would ` +
                    `make these permanent.`
                  }
                >
                  <span className="dot" />
                  {/* Naming the preset matters: after you load a sound from a
                      file, the amp still reports whichever slot is selected, and
                      an unqualified "14 changes" reads as nonsense. */}
                  {diff.count} vs preset {(diff.against ?? 0) + 1}
                  <button type="button" className="small" onClick={() => amp.revertAll()}>
                    Revert all
                  </button>
                </span>
              )}

              <span className="sep" />

              <button type="button" onClick={() => savePreset(live)}>
                Save to file
              </button>
              <button type="button" onClick={() => void loadFromFile()}>
                Load from file
              </button>

              <span className="sep" />

              {storing ? (
                <>
                  <span className="warn">Overwrite which slot?</span>
                  {Array.from({ length: HARDWARE_PRESETS }, (_, slot) => (
                    <button
                      key={slot}
                      type="button"
                      className="danger small"
                      onClick={() => {
                        amp.storeToSlot(slot)
                        setStoring(false)
                      }}
                    >
                      {slot + 1}
                    </button>
                  ))}
                  <button type="button" className="small" onClick={() => setStoring(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                // Storing overwrites a hardware slot and cannot be undone, so it
                // asks which one rather than acting on a single click.
                <button type="button" className="danger" onClick={() => setStoring(true)}>
                  Store to slot…
                </button>
              )}

              <span className="spacer" />
              {snapshot.bpm !== null && <span className="bpm">{snapshot.bpm.toFixed(0)} BPM</span>}
            </div>

            <Library live={live} onSend={send} />

            <div className="chain">
              {live.pedals.map((pedal, slot) => (
                <SlotCard
                  key={slot}
                  slot={slot}
                  pedal={pedal}
                  diff={slotDiff(diff, slot)}
                  onToggle={(s) => amp.toggleSlot(s)}
                  onSwap={(s, dsp) => amp.swapModel(s, dsp)}
                  onParam={(s, index, value) => amp.setParam(s, index, value)}
                  onRevertParam={(s, index) => amp.revertParam(s, index)}
                  onRevertSlot={(s) => amp.revertSlot(s)}
                />
              ))}
            </div>
          </>
        )}

        <ProtocolLog
          entries={snapshot.log}
          open={logOpen}
          raw={rawLog}
          recordedEvents={snapshot.recordedEvents}
          onToggleOpen={setLogOpen}
          onToggleRaw={setRawLog}
          onClear={() => amp.clearLog()}
          onSaveCapture={() => {
            const capture = amp.exportCapture(`spark session ${new Date().toISOString().slice(0, 19)}`)
            if (capture) saveCapture(capture)
          }}
        />
      </main>

      {dropping && <div className="dropzone">Drop a preset file to send it to the amp</div>}
    </>
  )
}

function Welcome() {
  return (
    <div className="welcome">
      <h2>Connect your Spark 40</h2>
      <ol>
        <li>
          Pair <b>Spark 40 Audio</b> in your operating system's Bluetooth settings. That link carries
          music and backing tracks.
        </li>
        <li>
          Leave <b>Spark 40 BLE</b> unpaired. It is the control link, and the browser claims it
          directly. Pairing it in the operating system is the usual reason the chooser comes up empty.
        </li>
        <li>
          Select <b>Connect</b>, then pick <b>Spark 40 BLE</b> from the browser's chooser.
        </li>
      </ol>

      <div className="note">
        Web Bluetooth runs in Chrome and Edge, on desktop and Android, over <code>localhost</code> or
        https. Safari, Firefox and every browser on iOS do not support it.
        <br />
        <br />
        No amp to hand? Select <b>Try without an amp</b> to drive a simulated Spark that answers the
        same protocol.
        <br />
        <br />
        Press <kbd>1</kbd> to <kbd>4</kbd> to switch presets once you are connected.
      </div>
    </div>
  )
}
