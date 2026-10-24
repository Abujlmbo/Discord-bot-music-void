/**
 * Fake Deafen — Revenge (mobile) port of the Vencord plugin by hyyven.
 *
 * While enabled, every voice-state update sent to the gateway is rewritten so
 * others see you muted/deafened, but your real audio is untouched.
 */

// ---- settings (edit here) -------------------------------------------------
const SETTINGS = {
    fakeMute: true,
    fakeDeafen: true,
}

// ---- tiny Metro helpers (no dependency on Revenge finder signatures) -------
type AnyObj = Record<string, any>

function findByProps(...props: string[]): AnyObj | undefined {
    const registry: AnyObj | undefined = (globalThis as AnyObj).modules
    if (!registry) return
    for (const id in registry) {
        const m = registry[id]
        if (!m?.isInitialized) continue
        const exp = m.publicModule?.exports
        if (!exp) continue
        for (const cand of [exp, exp.default]) {
            if (cand && typeof cand === 'object' && props.every(p => p in cand)) return cand
        }
    }
}

const TAG = '[FakeDeafen]'

// ---- state ----------------------------------------------------------------
let enabled = false
let socket: AnyObj | undefined
let originalSend: ((...a: any[]) => any) | undefined

function pushVoiceState() {
    const ChannelStore = findByProps('getChannel', 'getDMFromUserId')
    const SelectedChannelStore = findByProps('getVoiceChannelId')
    const MediaEngineStore = findByProps('isDeaf', 'isMute') ?? findByProps('isSelfDeaf', 'isSelfMute')
    if (!socket || !SelectedChannelStore) return

    const channelId = SelectedChannelStore.getVoiceChannelId()
    if (!channelId) return // not in a voice channel
    const channel = ChannelStore?.getChannel(channelId)

    const realMute = !!(MediaEngineStore?.isMute?.() ?? MediaEngineStore?.isSelfMute?.())
    const realDeaf = !!(MediaEngineStore?.isDeaf?.() ?? MediaEngineStore?.isSelfDeaf?.())

    try {
        // op 4 = VOICE_STATE_UPDATE (goes through the patched send below)
        socket.send(4, {
            guild_id: channel?.guild_id ?? null,
            channel_id: channelId,
            self_mute: (enabled && SETTINGS.fakeMute) || realMute,
            self_deaf: (enabled && SETTINGS.fakeDeafen) || realDeaf,
            self_video: false,
            flags: 0,
        })
    } catch (e) {
        console.error(TAG, 'failed to update voice state', e)
    }
}

function toggle(value = !enabled) {
    enabled = value
    pushVoiceState()
    console.log(TAG, enabled ? 'ON' : 'OFF')
    return enabled
}

export default {
    start() {
        const gateway = findByProps('getSocket')
        socket = gateway?.getSocket?.()
        if (!socket) {
            console.error(TAG, 'gateway socket not found')
            return
        }

        originalSend = socket.send
        const orig = originalSend!
        socket.send = function (op: number, data: any, ...rest: any[]) {
            if (op === 4 && enabled && data) {
                if (SETTINGS.fakeMute) data.self_mute = true
                if (SETTINGS.fakeDeafen) data.self_deaf = true
            }
            return orig.call(this, op, data, ...rest)
        }

        // Handle for toggling (see README): FakeDeafen.toggle()
        ;(globalThis as AnyObj).FakeDeafen = {
            toggle,
            get enabled() {
                return enabled
            },
        }
    },

    stop() {
        if (enabled) toggle(false)
        if (socket && originalSend) socket.send = originalSend
        socket = originalSend = undefined
        delete (globalThis as AnyObj).FakeDeafen
    },
}
