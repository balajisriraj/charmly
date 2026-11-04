"""The fast promo's score: an original upbeat track at 120 bpm in A major, synthesised in plain Python.

    python3 promo/music_upbeat.py out.wav <seconds> '<marks json>'

Marks (from blink.ts): reveal, steerIntro, steerDrop, outro, hits (times of the big words), bpm.
Intro: ticking hats under the hook. Reveal: a riser, then the drop: four-on-the-floor kick, claps, pumping
offbeat bass, chord stabs and a pentatonic hook. A hushed breakdown into "Steer.", then the second drop with
the hook up an octave. Impacts on every big word. Outro: the last chord rings out.
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
N = int((SECONDS + 3) * RATE)
L = [0.0] * N  # drums and lead: not pumped
R = [0.0] * N
PL = [0.0] * N  # pads, stabs, bass: pumped by the kick
PR = [0.0] * N
random.seed(11)
TABLE = 4096
SINE = [math.sin(2 * math.pi * i / TABLE) for i in range(TABLE)]
SAW = [1 - 2 * i / TABLE for i in range(TABLE)]

REVEAL = float(MARKS.get("reveal", 4.0))
STEER_IN = float(MARKS.get("steerIntro", SECONDS * 0.45))
STEER_DROP = float(MARKS.get("steerDrop", STEER_IN + 4))
OUTRO = float(MARKS.get("outro", SECONDS - 4))
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
    if t < OUTRO:
        return "lift"
    return "outro"


def note(freq, start, dur, amp, pan=0.0, attack=0.005, release=0.15, wave_=SINE, decay=None, harmonics=((1, 1.0),), bus="dry"):
    s0 = int(start * RATE)
    n = int((dur + release) * RATE)
    left, right = (L, R) if bus == "dry" else (PL, PR)
    gl, gr = amp * (1 - pan) * 0.7, amp * (1 + pan) * 0.7
    a_n, d_n, r_n = max(1, int(attack * RATE)), int(dur * RATE), max(1, int(release * RATE))
    steps = [(TABLE * freq * h / RATE, w) for h, w in harmonics]
    ph = [0.0] * len(steps)
    k = 1 / (decay * RATE) if decay else 0
    for j in range(n):
        i = s0 + j
        if i >= N:
            break
        env = j / a_n if j < a_n else 1.0
        if j >= d_n:
            env *= max(0.0, 1 - (j - d_n) / r_n)
        if k:
            env *= math.exp(-j * k)
        v = 0.0
        for idx, (st, w) in enumerate(steps):
            v += wave_[int(ph[idx]) & 4095] * w
            ph[idx] += st
        v *= env
        left[i] += v * gl
        right[i] += v * gr


def noise(start, dur, amp, decay=0.03, rise=False, pan=0.0, bright=True):
    s0, n = int(start * RATE), int(dur * RATE)
    last = 0.0
    for j in range(n):
        i = s0 + j
        if i >= N:
            break
        x = random.uniform(-1, 1)
        v = (x - last) if bright else (x + last) * 0.5
        last = x
        env = (j / n) ** 2.2 if rise else math.exp(-j / (decay * RATE))
        L[i] += v * env * amp * (1 - pan)
        R[i] += v * env * amp * (1 + pan)


def kick(start, amp=0.75):
    s0, n = int(start * RATE), int(0.32 * RATE)
    ph = 0.0
    for j in range(n):
        i = s0 + j
        if i >= N:
            break
        t = j / RATE
        ph += TABLE * (48 + 110 * math.exp(-t * 38)) / RATE
        v = SINE[int(ph) & 4095] * math.exp(-t * 11) * amp
        L[i] += v
        R[i] += v


def clap(start, amp=0.22):
    for d in (0.0, 0.009, 0.019):
        noise(start + d, 0.18, amp, decay=0.05, bright=False)


def impact(at):
    kick(at, 0.95)
    noise(at, 1.6, 0.22, decay=0.45)  # a crash
    note(hz(33), at, 0.6, 0.35, release=0.9, decay=0.5)  # a sub boom


CHORDS = [  # A, E, F#m, D: (bass, chord)
    (45, [57, 61, 64, 69]),
    (40, [56, 59, 64, 68]),
    (42, [57, 61, 66, 69]),
    (38, [57, 62, 66, 69]),
]
HOOK = [76, None, 73, 76, None, 78, 76, 73, 71, None, 73, None, 69, None, None, None]  # two bars of eighths
STAB = [0, 1.5, 3, 4.5, 6]  # eighth positions within a bar where chords hit

bars = int(SECONDS / BAR) + 1
for b in range(bars):
    t0 = b * BAR
    bass, chord = CHORDS[b % 4]
    for beat in range(4):
        at = t0 + beat * BEAT
        sec = section(at)
        if sec in ("drive", "lift"):
            kick(at)
            if beat in (1, 3):
                clap(at)
            noise(at + BEAT / 2, 0.09, 0.09, decay=0.035, pan=0.2)  # open hat on the offbeat
            for q in (0.25, 0.75):
                noise(at + BEAT * q, 0.03, 0.035, decay=0.01, pan=-0.3)  # quiet sixteenths
            note(hz(bass), at + BEAT / 2, BEAT * 0.42, 0.42, release=0.05, wave_=SAW, harmonics=((1, 1.0), (0.5, 0.6)), bus="pump")
        elif sec == "intro":
            noise(at, 0.04, 0.05, decay=0.012)
            noise(at + BEAT / 2, 0.04, 0.035, decay=0.012)
            if at > REVEAL - 2 * BEAT:  # a snare roll into the reveal
                for k in range(8):
                    clap(at + k * BEAT / 8, 0.05 + 0.02 * k)
        elif sec == "hush":
            if at > STEER_DROP - 2 * BEAT:
                for k in range(8):
                    clap(at + k * BEAT / 8, 0.05 + 0.025 * k)
    sec = section(t0 + 0.01)
    pad_amp = {"intro": 0.06, "drive": 0.05, "hush": 0.08, "lift": 0.05, "outro": 0.07}[sec]
    for i, n_ in enumerate(chord):
        note(hz(n_), t0, BAR, pad_amp, pan=(i - 1.5) * 0.3, attack=0.4, release=0.6, wave_=SAW, harmonics=((1, 0.5), (1.004, 0.5)), bus="pump")
    if sec in ("drive", "lift"):
        for pos in STAB:
            for i, n_ in enumerate(chord):
                note(hz(n_ + 12), t0 + pos * BEAT / 2, 0.06, 0.05, pan=(i - 1.5) * 0.4, release=0.12, harmonics=((1, 1.0), (2, 0.3)), decay=0.12, bus="pump")
        if b % 2 == 0:
            lift = 12 if sec == "lift" else 0
            for k, n_ in enumerate(HOOK):
                if n_ is not None:
                    at = t0 + k * BEAT / 2
                    note(hz(n_ + lift), at, 0.12, 0.11, pan=0.15, release=0.2, harmonics=((1, 1.0), (2, 0.4), (3, 0.15)), decay=0.25)
                    note(hz(n_ + lift), at + BEAT * 0.75, 0.12, 0.04, pan=-0.4, release=0.2, harmonics=((1, 1.0), (2, 0.4)), decay=0.25)

# Risers into the drops, impacts on the big words, the last chord.
for at, length in ((REVEAL, 2.0), (STEER_DROP, 3.0)):
    noise(at - length, length, 0.16, rise=True)
for h in HITS:
    impact(h)
for i, n_ in enumerate([57, 61, 64, 69, 73]):
    note(hz(n_), OUTRO, 4.0, 0.07, pan=(i - 2) * 0.25, attack=0.05, release=3.5, harmonics=((1, 1.0), (2, 0.25)))
note(hz(88), OUTRO, 0.05, 0.12, release=2.5, harmonics=((1, 1.0), (2.76, 0.3)), decay=0.9)

# Pump: the pads, stabs and bass duck under each kick, then breathe back; then a short room and a soft limiter.
pump_from = [REVEAL, STEER_DROP]
for i in range(min(N, int(SECONDS * RATE))):
    t = i / RATE
    sec = section(t)
    g = 1.0
    if sec in ("drive", "lift"):
        g = 0.3 + 0.7 * min(1.0, ((t % BEAT) / BEAT) / 0.45)
    L[i] += PL[i] * g
    R[i] += PR[i] * g
for delay, gain in ((0.027, 0.16), (0.043, 0.12), (0.067, 0.09), (0.101, 0.06)):
    d = int(delay * RATE)
    for i in range(N - 1, d - 1, -1):
        L[i] += R[i - d] * gain
        R[i] += L[i - d] * gain
peak = max(max(abs(x) for x in L), max(abs(x) for x in R)) or 1.0
drive = 1.6
scale = 0.9 / math.tanh(drive)
frames = bytearray()
for i in range(int(SECONDS * RATE)):
    frames += struct.pack("<hh", int(math.tanh(drive * L[i] / peak) * scale * 32767), int(math.tanh(drive * R[i] / peak) * scale * 32767))
with wave.open(OUT, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(bytes(frames))
print(f"  music: {SECONDS:.1f}s, A major, {BPM:.0f} bpm, {len(HITS)} hits")
