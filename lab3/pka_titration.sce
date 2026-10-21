// pKa of a weak acid by pH-metric titration with NaOH
// Alvin Saju  PES2UG26AM04

V  = 0:0.5:9.5;                                         // volume of NaOH (mL)
pH = [3.01 3.41 3.63 3.82 3.96 4.12 4.25 4.42 4.56 4.72 ..
      4.96 5.26 5.76 9.88 10.91 11.41 11.60 11.70 11.78 11.84];

dpH  = diff(pH) / 0.5;                                  // ΔpH / ΔV
Vd   = V(2:$);

[m, k] = max(dpH);
Veq    = Vd(k);                                         // equivalence point
Vhalf  = Veq / 2;                                       // half equivalence point
pKa    = interp1(V, pH, Vhalf);                         // pH at half equivalence

// ---------- Graph 1: pH vs volume ----------
f1 = scf(1); clf();
plot(V, pH, "-x");
plot([Veq Veq], [0 14], "r--");
plot([Vhalf Vhalf], [0 pKa], "r--");
plot([0 Vhalf], [pKa pKa], "r--");
a = gca(); a.data_bounds = [0 0; 10 14]; a.box = "on";
xtitle("", "Volume of NaOH (mL)", "pH");
xstring(0.3, 12.0, "scale:");
xstring(0.3, 11.2, "x-axis: 1cm = 0.5 mL");
xstring(0.3, 10.4, "y-axis: 1cm = 1 pH unit");
xstring(0.3,  9.4, "Alvin Saju");
xstring(0.3,  8.6, "PES2UG26AM04");
xstring(Veq + 0.1, 0.4, msprintf("Equivalence point = %.2f mL", Veq));
xstring(Vhalf + 0.1, 0.4, msprintf("Half eq. = %.2f mL", Vhalf));
xstring(0.3, pKa + 0.2, msprintf("pKa = %.2f", pKa));
xs2pdf(f1, "ph_vs_volume.pdf");
xs2png(f1, "ph_vs_volume.png");

// ---------- Graph 2: delta pH / delta V vs volume ----------
f2 = scf(2); clf();
plot(Vd, dpH, "-x");
plot([Veq Veq], [0 m], "r--");
a = gca(); a.data_bounds = [0 0; 10 9]; a.box = "on";
xtitle("", "Volume of NaOH (mL)", "ΔpH / ΔV");
xstring(0.3, 8.3, "scale:");
xstring(0.3, 7.7, "x-axis: 1cm = 0.5 mL");
xstring(0.3, 7.1, "y-axis: 1cm = 1 unit");
xstring(0.3, 6.4, "Alvin Saju");
xstring(0.3, 5.8, "PES2UG26AM04");
xstring(Veq + 0.5, 5.2, "Equivalence point");
xstring(Veq + 0.5, 4.7, msprintf("= %.2f mL", Veq));
xs2pdf(f2, "dph_dv_vs_volume.pdf");
xs2png(f2, "dph_dv_vs_volume.png");

exit;
