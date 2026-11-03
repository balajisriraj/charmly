"""Charmly's promo score: an original track, synthesised in plain Python and composed to the film's cut.

    python3 promo/music.py out.wav <seconds> '<marks json>'

Marks come from the film's timeline (render.mjs passes them): reveal, groove, steer, said, steerEnd, anywhereCard,
anywhere, outro. Warm pads in F major (Fmaj7, Am7, Dm7, Bbmaj9), a soft pluck arpeggio with a ping-pong echo,
a gentle kick, shaker and claps, a riser into each reveal and a bell on the moments that matter.
"""

import json
import math
import random
import struct
import sys
import wave

RATE = 44100
OUT, SECONDS, MARKS = sys.argv[1], float(sys.argv[2]), json.loads(sys.argv[3])
N = int(SECONDS * RATE) + RATE * 3
L = [0.0] * N
R = [0.0] * N
random.seed(7)

TABLE_SIZE = 4096
SINE = [math.sin(2 * math.pi * i / TABLE_SIZE) for i in range(TABLE_SIZE)]
BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT


def hz(note):
    """MIDI note number to frequency."""
    return 440.0 * 2 ** ((note - 69) / 12)


# Fmaj7, Am7, Dm7, Bbmaj9: (bass, chord tones)
PROGRESSION = [
    (41, [53, 57, 60, 64]),
    (45, [52, 57, 60, 64]),
    (38, [50, 53, 57, 60]),
    (46, [50, 53, 57, 60, 62]),
]
mk = lambda name, default: float(MARKS.get(name, default))  # noqa: E731
REVEAL, GROOVE, STEER = mk("reveal", 5.4), mk("groove", 9.0), mk("steer", 22.0)
STEER_ON = STEER + 7.6  # "Introducing Steer" lands; the beat returns
SAID, STEER_END = mk("said", STEER_ON + 26), mk("steerEnd", STEER_ON + 34)
ANY_CARD, ANYWHERE, OUTRO = mk("anywhereCard", STEER_END + 16), mk("anywhere", STEER_END + 19), mk("outro", SECONDS - 10)


def add(i, left, right):
    if 0 <= i < N:
        L[i] += left
        R[i] += right


def tone(freq, start, dur, amp, attack=0.01, release=0.3, pan=0.0, harmonics=((1, 1.0),), decay=None):
    """One note from a sine table: envelope, optional exponential decay, a few harmonics, panned."""
    s0 = int(start * RATE)
    n = int((dur + release) * RATE)
    gl, gr = amp * (1 - pan) / 2 ** 0.5, amp * (1 + pan) / 2 ** 0.5
    a_n, d_n = max(1, int(attack * RATE)), int(dur * RATE)
    r_n = max(1, int(release * RATE))
    steps = [(TABLE_SIZE * freq * h / RATE, w) for h, w in harmonics]
    phases = [0.0] * len(steps)
    k = 1 / (decay * RATE) if decay else 0
    for j in range(n):
        env = j / a_n if j < a_n else 1.0
        if j >= d_n:
            env *= max(0.0, 1 - (j - d_n) / r_n)
        if k:
            env *= math.exp(-j * k)
        v = 0.0
        for idx, (step, w) in enumerate(steps):
            v += SINE[int(phases[idx]) & 4095] * w
            phases[idx] += step
        add(s0 + j, v * env * gl, v * env * gr)


def noise(start, dur, amp, decay=0.05, rise=False, pan=0.0, bright=True):
    s0, n = int(start * RATE), int(dur * RATE)
    last = 0.0
    for j in range(n):
        x = random.uniform(-1, 1)
        v = x - last if bright else (x + last) / 2
        last = x
        env = (j / n) ** 2 if rise else math.exp(-j / (decay * RATE))
        add(s0 + j, v * env * amp * (1 - pan), v * env * amp * (1 + pan))


def kick(start, amp=0.55):
    s0, n = int(start * RATE), int(0.38 * RATE)
    phase = 0.0
    for j in range(n):
        t = j / RATE
        f = 45 + 75 * math.exp(-t * 30)
        phase += TABLE_SIZE * f / RATE
        v = SINE[int(phase) & 4095] * math.exp(-t * 9) * amp
        add(s0 + j, v, v)


def bell(freq, start, amp=0.16, pan=0.0):
    tone(freq, start, 0.05, amp, attack=0.002, release=2.4, pan=pan, harmonics=((1, 1.0), (2.76, 0.35), (5.4, 0.12)), decay=0.9)


def chord_at(t):
    return PROGRESSION[int(t / BAR) % len(PROGRESSION)]


def section(t):
    if t < REVEAL:
        return "intro"
    if t < GROOVE:
        return "reveal"
    if t < STEER:
        return "groove"
    if t < STEER_ON:
        return "hush"
    if t < STEER_END:
        return "drive"
    if t < OUTRO:
        return "groove"
    return "outro"


bars = int(SECONDS / BAR) + 2
for b in range(bars):
    t0 = b * BAR
    bass, notes = PROGRESSION[b % len(PROGRESSION)]
    sec = section(t0 + 0.01)
    pad_amp = {"intro": 0.05, "reveal": 0.07, "groove": 0.06, "hush": 0.045, "drive": 0.065, "outro": 0.06}[sec]
    for i, n in enumerate(notes):
        tone(hz(n), t0, BAR, pad_amp, attack=0.7, release=1.1, pan=(i / max(1, len(notes) - 1) - 0.5) * 0.9, harmonics=((1, 1.0), (1.003, 0.6), (2, 0.18)))
    if sec != "intro":
        tone(hz(bass), t0, BAR * 0.92, 0.16 if sec != "hush" else 0.1, attack=0.02, release=0.3, harmonics=((1, 1.0), (2, 0.25)))
    # The pluck: eighth-note arpeggio, with a ping-pong echo.
    if sec in ("groove", "drive", "reveal"):
        pattern = [0, 2, 1, 3, 2, 1, 3, 2] if sec != "reveal" else [0, None, 2, None, 1, None, 3, None]
        for k, p in enumerate(pattern):
            if p is None:
                continue
            note = notes[p % len(notes)] + 12
            at = t0 + k * BEAT / 2
            amp = 0.075 if sec == "drive" else 0.06
            tone(hz(note), at, 0.08, amp, attack=0.003, release=0.5, pan=-0.35, harmonics=((1, 1.0), (2, 0.3), (3, 0.08)), decay=0.22)
            tone(hz(note), at + BEAT * 0.75, 0.08, amp * 0.35, attack=0.003, release=0.5, pan=0.45, harmonics=((1, 1.0), (2, 0.3)), decay=0.22)
    # Drums.
    for beat in range(4):
        at = t0 + beat * BEAT
        sec_b = section(at)
        if sec_b in ("groove", "drive"):
            if beat in (0, 2):
                kick(at, 0.5 if sec_b == "drive" else 0.38)
            noise(at + BEAT / 2, 0.06, 0.05 if sec_b == "drive" else 0.035, decay=0.018, pan=0.25)
            if sec_b == "drive" and beat in (1, 3):
                for d in (0.0, 0.012, 0.024):
                    noise(at + d, 0.16, 0.06, decay=0.045, bright=False, pan=-0.1)
        elif sec_b == "outro" and beat == 0 and at < OUTRO + BAR:
            kick(at, 0.3)

# Risers into each reveal, and bells on the moments that matter.
for at, length in ((REVEAL, 1.6), (STEER + 3.4, 1.5), (ANY_CARD, 1.0)):
    noise(at - length, length, 0.09, rise=True)
for i, n in enumerate([65, 69, 72, 76]):
    bell(hz(n + 12), REVEAL + i * 0.11, 0.12, pan=-0.4 + i * 0.27)
bell(hz(77 + 12), STEER + 3.45, 0.13)
for i, n in enumerate([72, 76, 79, 84]):
    bell(hz(n + 12), SAID + 1.4 + i * 0.12, 0.13, pan=0.3 - i * 0.2)
for i, n in enumerate([53, 57, 60, 64, 69]):
    tone(hz(n), OUTRO + 4.6, 3.0, 0.07, attack=0.4, release=3.0, pan=(i - 2) * 0.2, harmonics=((1, 1.0), (2, 0.2)))
bell(hz(84 + 12), OUTRO + 4.7, 0.12)

# Space: a short multi-tap room, then a gentle limiter and normalisation.
for delay, gain in ((0.031, 0.22), (0.047, 0.18), (0.073, 0.14), (0.113, 0.1), (0.167, 0.07)):
    d = int(delay * RATE)
    for i in range(N - 1, d - 1, -1):
        L[i] += R[i - d] * gain
        R[i] += L[i - d] * gain
peak = max(max(abs(x) for x in L), max(abs(x) for x in R)) or 1.0
scale = 0.89 / math.tanh(1.3)
frames = bytearray()
for i in range(min(N, int(SECONDS * RATE))):
    left = int(max(-1, min(1, math.tanh(1.3 * L[i] / peak) * scale)) * 32767)
    right = int(max(-1, min(1, math.tanh(1.3 * R[i] / peak) * scale)) * 32767)
    frames += struct.pack("<hh", left, right)
with wave.open(OUT, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(bytes(frames))
print(f"  music: {SECONDS:.1f}s, F major, {BPM} bpm")
