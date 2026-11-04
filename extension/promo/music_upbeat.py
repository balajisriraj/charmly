"""The fast promo's score: modern, upbeat drums with a Japanese, philosophical colour. Original, synthesised in
plain Python.

    python3 promo/music_upbeat.py out.wav <seconds> '<marks json>'

Marks (from blink.ts): reveal, steerIntro, steerDrop, steerEnd, outro, hits, bpm (120).

  intro   a breathy shakuhachi-style flute over a drone, soft taiko, shime ticks building, a koto glissando
  drive   the drop: a punchy kick and clap, hi-hats with rolls, a deep 808 bass, warm chords that breathe with
          the kick, a koto riff in the Yo pentatonic scale, taiko on the downbeats and fills
  hush    the flute alone over a taiko heartbeat, then a taiko roll that accelerates into the drop
  story   Steer: half-time and spacious, big taiko ensemble hits, long koto phrases, the flute singing over it
  lift    the groove again, koto an octave up
  outro   three taiko hits and a koto arpeggio that rings out
"""

import json
import math
import random
import struct
import sys
import wave

RATE = 44100
OUT, SECONDS, MARKS = sys.argv[1], float(sys.argv[2]), json.loads(sys.argv[3])
BPM = float(MARKS.get("bpm", 120))
BEAT = 60 / BPM
BAR = 4 * BEAT
N = int((SECONDS + 4) * RATE)
L, R = [0.0] * N, [0.0] * N  # drums, koto, flute
PL, PR = [0.0] * N, [0.0] * N  # pads and bass, which breathe with the kick
random.seed(23)
TABLE = 4096
SINE = [math.sin(2 * math.pi * i / TABLE) for i in range(TABLE)]

REVEAL = float(MARKS.get("reveal", 4.0))
STEER_IN = float(MARKS.get("steerIntro", SECONDS * 0.4))
STEER_DROP = float(MARKS.get("steerDrop", STEER_IN + 4))
STEER_END = float(MARKS.get("steerEnd", STEER_DROP + 20))
OUTRO = float(MARKS.get("outro", SECONDS - 5))
HITS = [float(h) for h in MARKS.get("hits", [])]


def hz(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def section(t):
    if t < REVEAL:
        return "intro"
    if t < STEER_IN:
        return "drive"
    if t < STEER_DROP:
        return "hush"
    if t < STEER_END:
        return "story"
    if t < OUTRO:
        return "lift"
    return "outro"


def put(i, left, right, bus):
    if 0 <= i < N:
        if bus:
            PL[i] += left
            PR[i] += right
        else:
            L[i] += left
            R[i] += right


def tone(freq, start, dur, amp, pan=0.0, attack=0.005, release=0.2, harmonics=((1, 1.0),), decay=None, bend=0.0, bend_time=0.03, bus=False):
    """A sine-table note: envelope, optional decay, harmonics, and an initial pitch bend (in semitones)."""
    s0, n = int(start * RATE), int((dur + release) * RATE)
    gl, gr = amp * (1 - pan) * 0.7, amp * (1 + pan) * 0.7
    a_n, d_n, r_n = max(1, int(attack * RATE)), int(dur * RATE), max(1, int(release * RATE))
    ph = [0.0] * len(harmonics)
    k = 1 / (decay * RATE) if decay else 0
    b_n = max(1, int(bend_time * RATE))
    for j in range(n):
        env = j / a_n if j < a_n else 1.0
        if j >= d_n:
            env *= max(0.0, 1 - (j - d_n) / r_n)
        if k:
            env *= math.exp(-j * k)
        f = freq * (2 ** (bend * max(0.0, 1 - j / b_n) / 12)) if bend else freq
        v = 0.0
        for idx, (h, w) in enumerate(harmonics):
            v += SINE[int(ph[idx]) & 4095] * w
            ph[idx] += TABLE * f * h / RATE
        v *= env
        put(s0 + j, v * gl, v * gr, bus)


def noise(start, dur, amp, decay=0.03, pan=0.0, bright=True, rise=False):
    s0, n = int(start * RATE), int(dur * RATE)
    last = 0.0
    for j in range(n):
        x = random.uniform(-1, 1)
        v = (x - last) if bright else (x + last) * 0.5
        last = x
        env = (j / n) ** 2.4 if rise else math.exp(-j / (decay * RATE))
        put(s0 + j, v * env * amp * (1 - pan), v * env * amp * (1 + pan), False)


def drum(start, base, amp, decay, drop=1.2, drop_rate=35.0, skin=0.25, pan=0.0):
    """A pitched drum: a falling sine body, a second partial, and a short skin noise."""
    s0, n = int(start * RATE), int(decay * 6 * RATE)
    ph = ph2 = 0.0
    last = 0.0
    for j in range(n):
        t = j / RATE
        f = base * (1 + drop * math.exp(-t * drop_rate))
        ph += TABLE * f / RATE
        ph2 += TABLE * f * 1.58 / RATE
        body = SINE[int(ph) & 4095] * math.exp(-t / decay) + 0.3 * SINE[int(ph2) & 4095] * math.exp(-t / (decay * 0.4))
        x = random.uniform(-1, 1)
        sk = (x + last) * 0.5 * math.exp(-t * 90) * skin
        last = x
        v = (body + sk) * amp
        put(s0 + j, v * (1 - pan), v * (1 + pan), False)


def taiko(at, big=1.0, pan=0.0):
    drum(at, 58 / big ** 0.3, 0.75 * big, 0.32 * big, skin=0.45, pan=pan)


def shime(at, amp=0.16, pan=0.3):
    drum(at, 380, amp, 0.045, drop=0.15, drop_rate=60, skin=0.6, pan=pan)


def kick(at, amp=0.8):
    drum(at, 46, amp, 0.16, drop=2.4, drop_rate=42, skin=0.15)


def clap(at, amp=0.2, tail=True):
    for d in (0.0, 0.01, 0.021):
        noise(at + d, 0.12, amp, decay=0.035, bright=False)
    tone(210, at, 0.02, amp * 0.6, release=0.08, decay=0.04)
    if tail:
        noise(at + 0.03, 0.5, amp * 0.18, decay=0.16, bright=False, pan=0.2)


def hat(at, amp=0.05, open_=False, pan=-0.2):
    noise(at, 0.2 if open_ else 0.04, amp, decay=0.09 if open_ else 0.014, pan=pan)


def koto(note, at, amp=0.12, pan=0.0):
    tone(hz(note), at, 0.04, amp, pan=pan, attack=0.002, release=0.9, harmonics=((1, 1.0), (2, 0.45), (3, 0.2), (4.02, 0.08)), decay=0.45, bend=-0.45, bend_time=0.03)


def flute(note, at, dur, amp=0.1, pan=0.1):
    """A breathy, shakuhachi-like flute: a soft bend up into the note, vibrato that grows, breath noise."""
    s0, n = int(at * RATE), int((dur + 0.3) * RATE)
    f0 = hz(note)
    a_n, d_n, r_n = int(0.12 * RATE), int(dur * RATE), int(0.3 * RATE)
    ph = ph2 = 0.0
    last = 0.0
    for j in range(n):
        t = j / RATE
        env = min(1.0, j / a_n)
        if j >= d_n:
            env *= max(0.0, 1 - (j - d_n) / r_n)
        cents = -70 * max(0.0, 1 - t / 0.14) + 14 * min(1.0, max(0.0, t - 0.3) / 0.5) * math.sin(2 * math.pi * 5.2 * t)
        f = f0 * 2 ** (cents / 1200)
        ph += TABLE * f / RATE
        ph2 += TABLE * f * 2 / RATE
        x = random.uniform(-1, 1)
        breath = (x + last) * 0.5
        last = x
        v = (SINE[int(ph) & 4095] + 0.22 * SINE[int(ph2) & 4095] + breath * (0.35 if t < 0.15 else 0.12)) * env * amp
        put(s0 + j, v * (1 - pan), v * (1 + pan), False)


def bass808(note, at, dur, amp=0.32):
    s0, n = int(at * RATE), int((dur + 0.08) * RATE)
    f = hz(note)
    ph = 0.0
    for j in range(n):
        t = j / RATE
        env = min(1.0, j / 200) * (1 if j < dur * RATE else max(0.0, 1 - (j - dur * RATE) / (0.08 * RATE))) * (0.65 + 0.35 * math.exp(-t * 3))
        ph += TABLE * f / RATE
        v = math.tanh(1.8 * SINE[int(ph) & 4095]) * env * amp
        put(s0 + j, v, v, True)


def impact(at):
    taiko(at, 1.6)
    taiko(at + 0.02, 1.3, pan=0.4)
    kick(at, 0.9)
    noise(at, 1.8, 0.16, decay=0.5)
    tone(hz(26), at, 0.4, 0.3, release=1.2, decay=0.6)


# D, Bm, G, A in D major; melodies in the Yo pentatonic scale (D E G A B).
CHORDS = [(38, [62, 66, 69, 76]), (35, [62, 66, 71, 74]), (43, [62, 67, 71, 74]), (45, [61, 64, 69, 76])]
KOTO = [74, None, 71, 69, None, 67, 69, None, 74, 76, None, 74, 71, None, 69, None]
KOTO_STORY = [62, 64, 67, 69, None, 71, None, 69, 67, None, 64, None, 62, None, None, None]
FLUTE = [(69, 1.5), (67, 0.5), (69, 1.0), (71, 2.0), (69, 1.5), (64, 0.5), (62, 3.0)]
FLUTE_STORY = [(74, 3.0), (71, 1.0), (69, 2.0), (67, 2.0), (69, 4.0), (76, 2.0), (74, 2.0), (71, 4.0)]


def phrase(notes, start, end, amp=0.1):
    t = start
    while t < end:
        for n_, beats in notes:
            if t >= end:
                return
            flute(n_, t, min(beats * BEAT * 0.92, end - t), amp)
            t += beats * BEAT


bars = int(SECONDS / BAR) + 1
for b in range(bars):
    t0 = b * BAR
    bass, chord = CHORDS[b % 4]
    sec = section(t0 + 0.01)
    # Pads: warm, quiet, breathing with the kick in the busy sections.
    pad = {"intro": 0.045, "drive": 0.04, "hush": 0.05, "story": 0.05, "lift": 0.04, "outro": 0.05}[sec]
    for i, n_ in enumerate(chord):
        tone(hz(n_), t0, BAR, pad, pan=(i - 1.5) * 0.3, attack=0.45, release=0.6, harmonics=((1, 1.0), (1.004, 0.6), (2, 0.15)), bus=True)
    if sec in ("drive", "lift"):
        for k in (0.0, 1.75, 2.5):
            kick(t0 + k * BEAT)
        for k in (1, 3):
            clap(t0 + k * BEAT)
        for s16 in range(16):
            at = t0 + s16 * BEAT / 4
            hat(at, 0.05 if s16 % 2 == 0 else 0.03, pan=-0.25 + 0.1 * (s16 % 3))
        if b % 4 == 3:  # a hat roll into the next phrase
            for k in range(8):
                hat(t0 + 3.5 * BEAT + k * BEAT / 16, 0.035 + 0.004 * k, pan=0.3)
        hat(t0 + 0.5 * BEAT, 0.06, open_=True, pan=0.3)
        hat(t0 + 2.5 * BEAT, 0.06, open_=True, pan=0.3)
        for k, d in ((0.0, 1.6), (1.75, 0.7), (2.5, 1.4)):
            bass808(bass + 12 if bass < 36 else bass, t0 + k * BEAT, d * BEAT * 0.9)
        if b % 2 == 0:
            taiko(t0, 1.0, pan=-0.2)
        if b % 4 == 3:
            for k, big in ((3.0, 0.8), (3.25, 0.7), (3.5, 1.0), (3.75, 0.9)):
                taiko(t0 + k * BEAT, big, pan=0.25 if k % 0.5 else -0.25)
        for k in (0.75, 2.75):
            shime(t0 + k * BEAT, 0.1)
        if b % 2 == 0:
            lift = 12 if sec == "lift" else 0
            for k, n_ in enumerate(KOTO):
                if n_ is not None:
                    koto(n_ + lift, t0 + k * BEAT / 2, 0.11, pan=0.35 if k % 2 else -0.15)
    elif sec == "intro":
        for k in (0, 2):
            taiko(t0 + k * BEAT, 0.55, pan=-0.1)
        for k in range(8):
            shime(t0 + k * BEAT / 2, 0.035 + 0.01 * (t0 / max(REVEAL, 1)))
    elif sec == "hush":
        taiko(t0, 0.75)
        taiko(t0 + 0.75 * BEAT, 0.5)
    elif sec == "story":
        # Half-time and spacious: a big taiko on each downbeat, the clap on beat three.
        taiko(t0, 1.25, pan=-0.15)
        taiko(t0 + 0.02, 1.0, pan=0.3)
        kick(t0, 0.7)
        kick(t0 + 2.5 * BEAT, 0.55)
        clap(t0 + 2 * BEAT, 0.22)
        for k in range(8):
            hat(t0 + k * BEAT / 2, 0.04 if k % 2 == 0 else 0.025)
        bass808(bass + 12 if bass < 36 else bass, t0, BAR * 0.95, 0.28)
        if b % 2 == 0:
            for k, n_ in enumerate(KOTO_STORY):
                if n_ is not None:
                    koto(n_ + 12, t0 + k * BEAT / 2, 0.1, pan=0.3 if k % 2 else -0.2)

# The flute: over the hook, alone in the hush, singing over Steer's story, a last note at the end.
phrase(FLUTE, 0.15, REVEAL - 0.2, 0.09)
phrase(FLUTE, STEER_IN + 0.1, STEER_DROP - 0.4, 0.11)
phrase(FLUTE_STORY, STEER_DROP + 2 * BAR, STEER_END - 0.3, 0.075)
flute(74, OUTRO + 0.5, 3.0, 0.08)

# Into the drops: a koto glissando and a riser before the reveal; an accelerating taiko roll into "Steer."
for k, n_ in enumerate([62, 64, 67, 69, 71, 74, 76, 79]):
    koto(n_, REVEAL - 0.5 + k * 0.055, 0.08, pan=-0.4 + k * 0.1)
noise(REVEAL - 2.0, 2.0, 0.12, rise=True)
t = STEER_DROP - 2 * BEAT
gap = BEAT / 2
while t < STEER_DROP - 0.03:
    taiko(t, 0.6 + 0.6 * (1 - (STEER_DROP - t) / (2 * BEAT)), pan=random.uniform(-0.3, 0.3))
    t += gap
    gap = max(BEAT / 10, gap * 0.82)
noise(STEER_DROP - 2.5, 2.5, 0.12, rise=True)
for h in HITS:
    impact(h)
for k, big in ((0, 1.4), (1, 1.1), (2, 1.6)):
    taiko(OUTRO + k * BEAT, big, pan=(k - 1) * 0.3)
for k, n_ in enumerate([62, 66, 69, 74, 76, 79, 81, 86]):
    koto(n_, OUTRO + 3 * BEAT + k * 0.09, 0.09, pan=-0.35 + k * 0.1)
for i, n_ in enumerate([50, 62, 66, 69, 76]):
    tone(hz(n_), OUTRO + 3 * BEAT, 4.0, 0.06, pan=(i - 2) * 0.25, attack=0.08, release=3.5, harmonics=((1, 1.0), (2, 0.2)))

# Mix: pads and bass breathe with the kick in the busy sections; a hall for the taiko; a soft limiter.
for i in range(min(N, int(SECONDS * RATE))):
    t = i / RATE
    g = 1.0
    if section(t) in ("drive", "lift"):
        g = 0.35 + 0.65 * min(1.0, ((t % BEAT) / BEAT) / 0.5)
    L[i] += PL[i] * g
    R[i] += PR[i] * g
for delay, gain in ((0.031, 0.2), (0.053, 0.16), (0.089, 0.13), (0.137, 0.1), (0.211, 0.07), (0.317, 0.05)):
    d = int(delay * RATE)
    for i in range(N - 1, d - 1, -1):
        L[i] += R[i - d] * gain
        R[i] += L[i - d] * gain
peak = max(max(abs(x) for x in L), max(abs(x) for x in R)) or 1.0
drive = 1.7
scale = 0.9 / math.tanh(drive)
frames = bytearray()
for i in range(int(SECONDS * RATE)):
    frames += struct.pack("<hh", int(math.tanh(drive * L[i] / peak) * scale * 32767), int(math.tanh(drive * R[i] / peak) * scale * 32767))
with wave.open(OUT, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(bytes(frames))
print(f"  music: {SECONDS:.1f}s, D major (Yo pentatonic), {BPM:.0f} bpm, taiko, koto, flute, {len(HITS)} impacts")
