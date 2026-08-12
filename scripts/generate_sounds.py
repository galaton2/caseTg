"""
Генерирует простые оригинальные звуковые эффекты (синтез синусоидами/шумом),
чтобы не тащить в проект чужие лицензированные звуки.
Запускать один раз: python generate_sounds.py
Результат кладётся в frontend/assets/sounds/*.wav
"""
import math
import struct
import wave
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "frontend" / "assets" / "sounds"
OUT.mkdir(parents=True, exist_ok=True)
RATE = 44100


def envelope(i, n, attack=0.02, release=0.35):
    a = int(n * attack)
    r = int(n * release)
    if i < a:
        return i / max(a, 1)
    if i > n - r:
        return max(0.0, (n - i) / max(r, 1))
    return 1.0


def tone(freq, dur, vol=0.3, wave_fn=None, fm=None):
    n = int(RATE * dur)
    samples = []
    wave_fn = wave_fn or (lambda t: math.sin(2 * math.pi * freq * t))
    for i in range(n):
        t = i / RATE
        f = freq if fm is None else freq + fm(t)
        s = math.sin(2 * math.pi * f * t) if wave_fn is None else wave_fn(t)
        s *= vol * envelope(i, n)
        samples.append(s)
    return samples


def noise_burst(dur, vol=0.15):
    import random
    n = int(RATE * dur)
    return [vol * envelope(i, n, 0.01, 0.6) * (random.random() * 2 - 1) for i in range(n)]


def mix(*tracks):
    length = max(len(t) for t in tracks)
    out = [0.0] * length
    for t in tracks:
        for i, v in enumerate(t):
            out[i] += v
    peak = max(1.0, max(abs(v) for v in out))
    return [v / peak * 0.9 for v in out]


def concat(*tracks):
    out = []
    for t in tracks:
        out.extend(t)
    return out


def save(name, samples):
    path = OUT / name
    with wave.open(str(path), "w") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        frames = b"".join(struct.pack("<h", max(-32767, min(32767, int(s * 32767)))) for s in samples)
        f.writeframes(frames)
    print("saved", path)


def sine(freq, dur, vol=0.3):
    return tone(freq, dur, vol)


# 1) click.wav — короткий UI-клик
save("click.wav", sine(1200, 0.045, 0.25))

# 2) tick.wav — тик прокрутки рулетки (короткий, сухой)
save("tick.wav", mix(sine(2200, 0.03, 0.2), noise_burst(0.02, 0.08)))

# 3) purchase.wav — звёзды оплачены (два восходящих тона)
save("purchase.wav", concat(sine(660, 0.09, 0.28), sine(990, 0.16, 0.3)))

# 4) win_common.wav — обычный/необычный выигрыш, короткий приятный "дзинь"
save("win_common.wav", concat(sine(523, 0.08, 0.25), sine(784, 0.18, 0.28)))

# 5) win_rare.wav — редкий, чуть ярче и длиннее
save("win_rare.wav", concat(sine(523, 0.07, 0.25), sine(659, 0.07, 0.27), sine(880, 0.22, 0.3)))

# 6) win_epic.wav — эпик, аккорд
save("win_epic.wav", mix(sine(523, 0.32, 0.22), sine(659, 0.32, 0.22), sine(784, 0.32, 0.22)))

# 7) win_legendary.wav — легендарка, фанфары + шум-вспышка
fanfare = concat(
    sine(523, 0.1, 0.3), sine(659, 0.1, 0.3), sine(784, 0.1, 0.3),
    mix(sine(1046, 0.4, 0.3), sine(784, 0.4, 0.25), sine(1318, 0.4, 0.2)),
)
save("win_legendary.wav", mix(fanfare, concat([0] * int(RATE * 0.05), noise_burst(0.5, 0.12))))
