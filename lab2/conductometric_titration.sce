// Conductometric titration of HCl + CH3COOH mixture with NaOH
// Alvin Saju  PES2UG26AM04

V = 0:0.5:10;                                   // volume of NaOH (mL)
G = [16.2 14.8 12.8 10.7 8.5 7.1 7.4 7.9 8.3 8.7 9.0 ..
     9.3 9.6 10.3 11.3 12.2 13.4 14.2 14.9 15.6 16.4];  // conductance (mS)

// best-fit straight line for each part of the curve
[m1, c1] = reglin(V(1:6),   G(1:6));            // 0 - 2.5 mL   (HCl)
[m2, c2] = reglin(V(6:14),  G(6:14));           // 2.5 - 6.5 mL (CH3COOH)
[m3, c3] = reglin(V(14:21), G(14:21));          // 6.5 - 10 mL  (excess NaOH)

V1 = (c2 - c1) / (m1 - m2);                     // first equivalence point
V2 = (c3 - c2) / (m2 - m3);                     // second equivalence point
G1 = m1*V1 + c1;
G2 = m2*V2 + c2;
mprintf("V1 = %.2f mL, V2 = %.2f mL\n", V1, V2);

clf();
x = [0 4];    plot(x, m1*x + c1, "b-");
x = [1 8];    plot(x, m2*x + c2, "b-");
x = [4.5 11]; plot(x, m3*x + c3, "b-");
plot(V, G, "ko");
plot([V1 V1], [0 G1], "r--");
plot([V2 V2], [0 G2], "r--");

a = gca();
a.data_bounds = [0 0; 12 18];
a.box = "on";
xtitle("", "Volume of NaOH (mL)", "Conductance (mS)");

xstring(3.6, 17.0, "scale:");
xstring(3.6, 16.0, "x-axis: 1cm = 1 mL");
xstring(3.6, 15.0, "y-axis: 1cm = 1 unit");
xstring(3.6, 13.8, "Alvin Saju");
xstring(3.6, 12.8, "PES2UG26AM04");
xstring(V1 + 0.1, 0.4, msprintf("V1 = %.1f mL", V1));
xstring(V2 + 0.1, 0.4, msprintf("V2 = %.1f mL", V2));

xs2pdf(gcf(), "conductometric_titration.pdf");
xs2png(gcf(), "conductometric_titration.png");
