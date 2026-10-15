# EPD (UE26EC141A) — ESA question map, Units 1 and 2

Papers available (8enterprise `EPD/Papers/ESA Papers/`): only two, both **ESA Jan–Feb 2025, UE24EC141A**
(previous syllabus code, same 4-unit structure as UE26EC141A: U1 diode, U2 diode applications, U3 BJT + op-amp,
U4 digital). They are two different sets (set 1, set 2), not duplicates. Q1 = Unit 1, Q2 = Unit 2 in both sets.
Source tags: `ESA Jan-25 s1 1a`, `ESA Jan-25 s2 1c`, etc. Rendered pages: `render/p1-*.png` (set 1), `render/p2-*.png` (set 2).
Printed answers (in the paper, by the setter) are quoted; verify each one with sympy.

## Unit 1 (bucket sessions 001–014)

| Paper | Q | Marks | Exact text (abridged only where marked …) | Session |
|---|---|---|---|---|
| ESA Jan-25 s1 | 1a(i) | 4 | Determine the dynamic resistance of a diode at a temperature of 40 °C and a forward bias voltage of 0.6 V, if the reverse saturation current is 5 pA at 300 K. n = 1. (printed answer "0.46107 m ohms" — check) | 005 (also 003 Shockley, 004 temperature) |
| ESA Jan-25 s1 | 1a(ii) | 4 | Determine I_D and V_0 in the circuit: +20 V — 6.8 kΩ — node V_0 — Si diode (anode at V_0, current I_D left→right) — −20 V. (printed answer 5.77 mA) | 006 |
| ESA Jan-25 s1 | 1b | 9 | What are the different approximations used to represent the diode? For each of them draw the equivalent circuit and VI characteristics. | 006 (005 ideal vs practical) |
| ESA Jan-25 s1 | 1c(i) | 4 | Briefly explain the working … and draw output waveforms assuming ideal diodes: sine v_i (±V_m); series R, then shunt branch = diode (cathode up, anode down) in series with battery V (+ on top) to ground; v_o across the shunt branch. | 010 |
| ESA Jan-25 s1 | 1c(ii) | 4 | Same question: square wave v_i (+V for 0–T/2, −V for T/2–T); series C, shunt diode (anode to ground, cathode to the top line), R in parallel; v_o across R. | 011 |
| ESA Jan-25 s2 | 1a | 6 | Describe the Temperature Effects on V-I Characteristics of a Diode with Forward and Reverse biased and suitable diagrams? (Diagram 2 M + Forward 2 M + Reverse 2 M) | 004 |
| ESA Jan-25 s2 | 1b | 4 | Determine the voltages and current through 20 Ω and 10 Ω resistor and also the total current (I) for the configuration (circuit: 20 V battery; Si diode in series to 10 Ω; Si diode vertical to 20 Ω; see render/p2-1.png). Printed answers 19.3, 1.93; 19.3, 0.965; 2.895. | 007 |
| ESA Jan-25 s2 | 1c | 6 | The reverse saturation current of a Germanium diode is 200 µA at room temperature of 27 °C. Calculate the current in forward biased condition, if forward biased voltage is 0.2 V at room temperature. If temperature is increased by 30 °C, calculate the reverse saturation current and the forward current for the same forward voltage at new temperature. Given k = 1.38×10⁻²³ J/K, q = 1.60×10⁻¹⁹ C. | 004 (Shockley from 003) |
| ESA Jan-25 s2 | 1d(i) | 4 | Find the output voltage for the clipper network with ideal diode, if the applied signal is the square wave (+20 V for 0–T/2, −10 V for T/2–T). Circuit: series battery V = 5 V (− on the left/input side, + on the right) then series diode (anode left) then R to ground; v_o across R. | 009 |
| ESA Jan-25 s2 | 1d(ii) | 5 | Determine v_o for the network with ideal diode for the input shown: square wave +10 V / −20 V, f = 1000 Hz; C = 1 µF series; shunt diode (cathode up to the top line? — read render/p2-2.png: diode symbol pointing up, anode at the battery) in series with V = 5 V (+ up); R = 100 kΩ in parallel; v_o across R. | 011 |

Never asked in the two papers: intrinsic/extrinsic semiconductor theory (001), no-bias depletion region (002) as a
stand-alone question, logic gates with diodes (008), experiential learning (013/014). Asked: Shockley + temperature
(2×), diode resistance (1×), series/series-parallel configuration (2×), diode approximations (1×), clippers (2×),
clampers (2×).

## Unit 2 (no bucket folder; material = 8enterprise EPD_Notes_U2)

| Paper | Q | Marks | Exact text | Topic pack |
|---|---|---|---|---|
| ESA Jan-25 s1 | 2a | 8 | (i) With the circuit explain how PIV of the diode is determined in a bridge rectifier. (3M) (ii) Draw the output waveform and determine the average value of the output voltage in the circuit shown (v_i = ±100 V sine; bridge with two ideal diodes (top arms) and two 2.2 kΩ resistors (bottom arms), load 2.2 kΩ). (5M) | ec-u2-02 full-wave |
| ESA Jan-25 s1 | 2b | 9 | Draw the circuit of a full-wave rectifier with C filter and explain its working. Draw the output waveform. If R_L = 500 Ω, C = 500 µF and average load current is 20 mA for the same circuit, determine the RMS value of the ripple voltage. Assume f = 50 Hz. | ec-u2-03 capacitor filter |
| ESA Jan-25 s1 | 2c | 8 | (i) What are the conditions for a zener diode to operate as a voltage regulator? (2M) (ii) Determine R_Lmin and R_Lmax to obtain an output voltage of 10 V for a zener regulator with V_i = 20 V, P_Zmax = 400 mW, I_Zmin = 1 mA and R = 220 Ω. (6M) | ec-u2-04 zener regulator |
| ESA Jan-25 s2 | 2a | 6 | With a neat circuit diagram and waveform explain the working principle of Center Tapped Full wave Rectifier? | ec-u2-02 |
| ESA Jan-25 s2 | 2b | 8 | Derive the expression for V_dc, V_rms for Half wave Rectifier (Ideal Diode) and hence find the ripple factor of the Rectifier. | ec-u2-01 HWR |
| ESA Jan-25 s2 | 2c | 6 | A bridge full wave rectifier using silicon diodes has a load resistance of 1.5 kΩ. The rms voltage across the secondary is 20 V. Calculate peak value of load current, average load current and rms output voltage. (4M) And also for same full wave rectifier calculate the dc voltage if capacitor filter with 500 µF capacitor and a load current of 200 mA with 8% ripple. (2M) | ec-u2-02 (+ ec-u2-03 for the filter part) |
| ESA Jan-25 s2 | 2d | 5 | Find the range of load resistance and the maximum power rating for the circuit (V_i = 40 V, R = 250 Ω, V_Z = 10 V, I_ZM = 32 mA, variable R_L). | ec-u2-04 |
