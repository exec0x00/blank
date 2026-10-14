// Estimation of copper in brass - colorimetric method
// Alvin Saju  PES2UG26AM04

V  = [0 2 4 6 8 10];                 // volume of Cu(NO3)2 (mL)
OD = [0 0.02 0.04 0.06 0.08 0.11];   // optical density

OD_unknown = 0.05;
V_unknown  = OD_unknown / 0.01;      // from the line OD = 0.01 x V  -> 5 mL

clf();
x = [0 11];
plot(x, 0.01*x, "b-");               // calibration line
plot(V, OD, "ko");                   // observed points
plot([V_unknown V_unknown], [0 OD_unknown], "r--");
plot([0 V_unknown], [OD_unknown OD_unknown], "r--");
plot(V_unknown, OD_unknown, "r*");

a = gca();
a.data_bounds = [0 0; 12 0.12];
a.box = "on";
xtitle("", "Volume of Cu(NO3)2 (mL)", "Optical Density");

xstring(0.6, 0.110, "scale:");
xstring(0.6, 0.104, "x-axis: 1cm = 2 mL");
xstring(0.6, 0.098, "y-axis: 1cm = 0.02 unit");
xstring(0.6, 0.090, "Alvin Saju");
xstring(0.6, 0.084, "PES2UG26AM04");
xstring(V_unknown + 0.2, 0.002, "V = 5 mL");

xs2pdf(gcf(), "copper_colorimetry.pdf");
xs2png(gcf(), "copper_colorimetry.png");
