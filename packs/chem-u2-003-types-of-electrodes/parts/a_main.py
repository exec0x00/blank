"""Class 003: types of electrodes."""
ADD = "added for clarity"
TONLY = "transcript only"
NOTCUR = "not on current slides"

TOPICS = [
    {"id": "T1", "title": "Types of electrodes: the map",
     "overview": r"A cell needs two half-cells, so two electrodes; which electrode is used depends on the application. The deck "
                 r"lists six types: metal–metal ion, metal–metal insoluble salt–anion, gas, amalgam, oxidation–reduction (with the "
                 r"quinhydrone electrode as a special case) and ion-selective (membrane) electrodes. For every type you should "
                 r"know four things: the representation, the electrode reaction written as a reduction, the Nernst equation "
                 r"and one example. One procedure writes the Nernst equation for all of them."},
    {"id": "T2", "title": "Metal–metal ion electrode",
     "overview": r"A metal rod dips in a solution of its own ions, e.g. $\mathrm{Zn|Zn^{2+}}$, $\mathrm{Cu|Cu^{2+}}$, "
                 r"$\mathrm{Ag|Ag^+}$. A potential develops at the metal–solution interface. The reaction is "
                 r"$\mathrm{M^{n+}+ne^-\rightleftharpoons M}$ and the pure metal has activity 1, so the potential depends only on "
                 r"$[\mathrm{M^{n+}}]$: $E=E^\circ+\frac{0.0591}{n}\log[\mathrm{M^{n+}}]$."},
    {"id": "T3", "title": "Metal–metal insoluble salt–anion electrode",
     "overview": r"A metal is in contact with a sparingly soluble salt of the same metal, dipped in a solution of a soluble salt "
                 r"of the same anion. Examples: the calomel electrode $\mathrm{Hg|Hg_2Cl_2|KCl}$ and the silver–silver chloride "
                 r"electrode $\mathrm{Ag|AgCl(s)|HCl}$. For $\mathrm{Ag/AgCl}$, $\mathrm{AgCl+e^-\rightleftharpoons Ag+Cl^-}$ "
                 r"and $E=E^\circ-0.0591\log[\mathrm{Cl^-}]$: the electrode responds to the anion, not to the metal ion."},
    {"id": "T4", "title": "Gas electrode",
     "overview": r"A gas bubbles around an inert metal foil (platinum) dipped in a solution of the ions to which the gas is "
                 r"reversible. The platinum provides electrical contact and helps set up the gas–ion equilibrium. Examples: the "
                 r"hydrogen electrode $\mathrm{Pt|H_2|H^+}$ and the chlorine electrode $\mathrm{Pt|Cl_2|Cl^-}$. In the Nernst "
                 r"equation the gas enters as its partial pressure: $E=E^\circ-\frac{0.0591}{2}\log\frac{p_{H_2}}{[H^+]^2}$. "
                 r"Asked in ESA Dec 2023 as a 2-mark note."},
    {"id": "T5", "title": "Amalgam electrode",
     "overview": r"The same as a metal–metal ion electrode, but the metal is an amalgam (an alloy with mercury), e.g. the lead "
                 r"amalgam electrode $\mathrm{Pb\!-\!Hg|Pb^{2+}}$. Amalgamation lowers the activity of a reactive metal such as "
                 r"sodium so that a potential can be measured, and the activity can be set by the mercury content. Because "
                 r"the metal is no longer pure, its concentration appears in the Nernst equation."},
    {"id": "T6", "title": "Oxidation–reduction electrodes and the quinhydrone electrode",
     "overview": r"An inert metal (platinum) dips in a solution containing both the oxidised and the reduced form of a redox "
                 r"system, e.g. $\mathrm{Pt|Fe^{3+},Fe^{2+}}$, $\mathrm{Pt|Ce^{4+},Ce^{3+}}$, $\mathrm{Pt|Sn^{4+},Sn^{2+}}$. The "
                 r"metal is only an electrical contact; the potential comes from the tendency of one form to change into the "
                 r"other and depends on the ratio [reduced]/[oxidised]. The quinhydrone electrode $\mathrm{Pt|Q,QH_2}$ is a "
                 r"special case whose potential also depends on $[\mathrm{H^+}]$: $E^\circ=+0.699$ V. Asked in ESA Dec 2023."},
    {"id": "T7", "title": "Ion-selective (membrane) electrode",
     "overview": r"An ion-selective electrode has a membrane in contact with the solution with which it can exchange ions, so it "
                 r"develops a potential that depends on the concentration of one particular ion in the presence of others. "
                 r"The glass electrode, used in pH meters, is selective to $\mathrm{H^+}$ (also $\mathrm{Na^+}$, $\mathrm{K^+}$): "
                 r"$E_G=E^\circ_G+0.0591\log[\mathrm{H^+}]=E^\circ_G-0.0591\,\mathrm{pH}$. ESA asks the definition and the cell "
                 r"with a calomel electrode; the pH numericals are Unit 3."},
]

DEFS = [
    {"topic": "T1", "term": "Electrode (half-cell)", "text": r"One of the two halves of a cell: a conductor in contact with an "
     r"electrolyte at whose interface a potential develops. “In order to form a cell, 2 half cells or 2 electrodes are required.”",
     "srcs": ["S003·3", "T003 00:00:31"]},
    {"topic": "T2", "term": "Metal–metal ion electrode", "text": r"Metal in contact with a solution of its own ions, e.g. "
     r"$\mathrm{Zn/Zn^{2+}}$, $\mathrm{Cu/Cu^{2+}}$, $\mathrm{Ag/Ag^+}$.", "srcs": ["S003·3", "T003 00:00:59"]},
    {"topic": "T3", "term": "Metal–metal insoluble salt–anion electrode", "text": r"These electrodes consist of a metal in "
     r"contact with a sparingly soluble salt of the same metal dipped in a solution of soluble salt of the same anion, e.g. "
     r"calomel electrode $\mathrm{Hg/Hg_2Cl_2/KCl}$, $\mathrm{Ag/AgCl(s)/HCl}$.", "srcs": ["S003·4", "T003 00:02:31"]},
    {"topic": "T4", "term": "Gas electrode", "text": r"It consists of gas bubbling about an inert metal foil, immersed in "
     r"solution containing ions to which the gas is reversible. The metal provides electrical contact and facilitates the "
     r"establishment of equilibrium between the gas and its ions, e.g. hydrogen electrode $\mathrm{Pt/H_2/H^+}$, chlorine "
     r"electrode $\mathrm{Pt/Cl_2/Cl^-}$.", "srcs": ["S003·5", "T003 00:05:23"]},
    {"topic": "T5", "term": "Amalgam electrode", "text": r"It is similar to the metal–metal ion electrode, in which a metal "
     r"amalgam is in contact with a solution containing its own ions, e.g. lead amalgam electrode $\mathrm{Pb\!-\!Hg/Pb^{2+}}$.",
     "srcs": ["S003·6", "T003 00:08:59"]},
    {"topic": "T5", "term": "Amalgam", "text": r"An alloy of a metal with mercury.", "srcs": ["T003 00:08:59"], "flags": [TONLY]},
    {"topic": "T6", "term": "Oxidation–reduction (redox) electrode", "text": r"It consists of an inert metal such as platinum "
     r"immersed in a solution containing an appropriate oxidised and reduced form of a redox system. The metal merely acts as "
     r"electrical contact. The potential arises due to the tendency of one form to change into the other form, e.g. "
     r"$\mathrm{Pt/Fe^{2+},Fe^{3+}}$, $\mathrm{Pt/Ce^{3+},Ce^{4+}}$, $\mathrm{Pt/Sn^{2+},Sn^{4+}}$.",
     "srcs": ["S003·7", "T003 00:11:52"]},
    {"topic": "T6", "term": "Quinhydrone electrode", "text": r"An inert metal such as platinum immersed in a solution containing "
     r"quinone and hydroquinone; the metal merely acts as electrical contact and the potential arises due to the tendency of "
     r"quinone to change to hydroquinone. Representation $\mathrm{Pt/Q,QH_2}$.", "srcs": ["S003·8", "T003 00:14:02"]},
    {"topic": "T6", "term": "Quinhydrone", "text": r"An equimolar (1 : 1) compound of quinone and hydroquinone; dissolving it "
     r"gives $[Q]=[\mathrm{QH_2}]$, which is why the electrode's potential then depends only on pH.",
     "srcs": ["S003·8"], "flags": [ADD]},
    {"topic": "T7", "term": "Ion-selective electrode (membrane electrode)", "text": r"It consists of a membrane in contact with a "
     r"solution, with which it can exchange ions; it develops a potential that depends on the concentration of one particular "
     r"ion in the presence of other ions. E.g. the glass electrode, selective to $\mathrm{H^+}$, $\mathrm{Na^+}$, $\mathrm{K^+}$.",
     "srcs": ["S003·9", "T003 00:16:05", "PDF p.44", "ESA Jun-24a 2b", "ESA Jan-25 s1 2b"]},
]

STATEMENTS = [
    {"topic": "T1", "text": r"In order to form a cell, 2 half cells or 2 electrodes are required. Various types of electrodes are "
     r"available which are constructed based on the application.", "srcs": ["S003·3"]},
    {"topic": "T4", "text": r"The metal provides electrical contact and facilitates the establishment of equilibrium between the gas "
     r"and its ions.", "srcs": ["S003·5"]},
    {"topic": "T6", "text": r"The metal merely acts as electrical contact. The potential arises due to the tendency of one form to "
     r"change in to other form.", "srcs": ["S003·7"]},
    {"topic": "T7", "text": r"Equation for determining potential for pH sensitive Glass electrode: "
     r"$E_G=E^0_G+0.0591\log_{10}[\mathrm{H^+}]$.", "srcs": ["S003·9"]},
]

FORMULAS = [
    {"id": "E1.1", "topic": "T1", "title": "Nernst equation for any electrode (reduction form)",
     "tex": r"E=E^\circ-\frac{2.303RT}{nF}\log\frac{[\text{products}]}{[\text{reactants}]}=E^\circ-\frac{0.0591}{n}\log\frac{[\text{products}]}{[\text{reactants}]}\ \ (298\ \mathrm{K})",
     "gives": "The single-electrode (reduction) potential at any concentration.", "when": "Write the electrode reaction as a reduction first; pure solids and pure metals count as 1, gases enter as partial pressure in atm.",
     "units": "V", "note": r"$2.303RT/F=0.0591$ V at 298 K (0.05914 with $R=8.314$, $F=96485$).", "stars": 2,
     "srcs": ["T003 00:01:38", "T003 00:07:50"]},
    {"id": "E2.1", "topic": "T2", "title": "Metal–metal ion electrode",
     "tex": r"E_{\mathrm{M^{n+}/M}}=E^\circ_{\mathrm{M^{n+}/M}}+\frac{2.303RT}{nF}\log[\mathrm{M^{n+}}]",
     "gives": r"Potential of $\mathrm{M|M^{n+}}$.", "when": r"$\mathrm{M^{n+}+ne^-\rightleftharpoons M}$; pure metal, activity 1.",
     "units": "V", "note": r"Same as $E^\circ-\frac{0.0591}{n}\log\frac{1}{[\mathrm{M^{n+}}]}$: the + sign comes from inverting the log.", "stars": 1,
     "srcs": ["S003·3", "T003 00:02:15"]},
    {"id": "E3.1", "topic": "T3", "title": "Silver–silver chloride electrode",
     "tex": r"E_{\mathrm{Ag/AgCl/Cl^-}}=E^\circ_{\mathrm{Ag/AgCl/Cl^-}}-\frac{0.0591}{1}\log[\mathrm{Cl^-}]",
     "gives": r"Potential of $\mathrm{Ag|AgCl(s)|Cl^-}$.", "when": r"$\mathrm{AgCl+e^-\rightleftharpoons Ag+Cl^-}$; $n=1$.",
     "units": "V", "note": r"Reversible to $\mathrm{Cl^-}$: $E$ falls as $[\mathrm{Cl^-}]$ rises. $E^\circ\approx0.222$ V (given data).", "stars": 1,
     "srcs": ["S003·4", "T003 00:04:57"]},
    {"id": "E3.2", "topic": "T3", "title": "Calomel electrode (same type)",
     "tex": r"\mathrm{Hg_2Cl_2+2e^-\rightleftharpoons 2Hg+2Cl^-},\qquad E=E^\circ-\frac{0.0591}{2}\log[\mathrm{Cl^-}]^2=E^\circ-0.0591\log[\mathrm{Cl^-}]",
     "gives": r"Potential of $\mathrm{Hg|Hg_2Cl_2(s)|KCl}$.", "when": "Reference electrode of class 004.",
     "units": "V", "note": "SCE (saturated KCl) 0.2422 V, 1 M 0.2824 V, 0.1 M 0.3358 V at 298 K (consolidated PDF).", "stars": 1,
     "srcs": ["S003·4", "PDF p.33"], "flags": [NOTCUR]},
    {"id": "E4.1", "topic": "T4", "title": "Hydrogen electrode",
     "tex": r"E_{\mathrm{Pt/H_2/H^+}}=E^\circ_{\mathrm{Pt/H_2/H^+}}-\frac{0.0591}{2}\log\frac{p_{\mathrm{H_2}}}{[\mathrm{H^+}]^2}",
     "gives": r"Potential of $\mathrm{Pt|H_2(p)|H^+}$.", "when": r"$\mathrm{2H^++2e^-\rightleftharpoons H_2}$; $n=2$; $E^\circ=0$ by convention.",
     "units": "V", "note": r"SHE: $p_{H_2}=1$ atm, $[\mathrm{H^+}]=1$ M, so the log term is 0 and $E=E^\circ=0$.", "stars": 2,
     "srcs": ["S003·5", "T003 00:07:50", "T003 00:08:38"]},
    {"id": "E4.2", "topic": "T4", "title": "Hydrogen electrode in terms of pH",
     "tex": r"E=-\frac{0.0591}{2}\log p_{\mathrm{H_2}}-0.0591\,\mathrm{pH}\qquad(p_{\mathrm{H_2}}=1\ \text{atm}:\ E=-0.0591\,\mathrm{pH})",
     "gives": "The pH dependence of the hydrogen electrode.", "when": r"From E4.1 with $E^\circ=0$ and $\mathrm{pH}=-\log[\mathrm{H^+}]$.",
     "units": "V", "note": "A hydrogen electrode can therefore measure pH.", "stars": 2,
     "srcs": ["S003·5"], "flags": [ADD]},
    {"id": "E4.3", "topic": "T4", "title": "Chlorine electrode",
     "tex": r"\mathrm{Cl_2+2e^-\rightleftharpoons 2Cl^-},\qquad E=E^\circ-\frac{0.0591}{2}\log\frac{[\mathrm{Cl^-}]^2}{p_{\mathrm{Cl_2}}}",
     "gives": r"Potential of $\mathrm{Pt|Cl_2(p)|Cl^-}$.", "when": r"$n=2$; $E^\circ=1.36$ V (given data).",
     "units": "V", "note": "The slide names the chlorine electrode but gives only the hydrogen equation.", "stars": 1,
     "srcs": ["S003·5", "T003 00:06:45"], "flags": [ADD]},
    {"id": "E5.1", "topic": "T5", "title": "Lead amalgam electrode",
     "tex": r"E_{\mathrm{Pb^{2+}/Pb\text{-}Hg}}=E^\circ_{\mathrm{Pb^{2+}/Pb\text{-}Hg}}-\frac{0.0591}{2}\log\frac{[\mathrm{Pb\text{-}Hg}]}{[\mathrm{Pb^{2+}}]}",
     "gives": r"Potential of $\mathrm{Pb\!-\!Hg|Pb^{2+}}$.", "when": r"$\mathrm{Pb^{2+}+2e^-\rightleftharpoons Pb(Hg)}$; $n=2$.",
     "units": "V", "note": "Unlike a pure metal, the amalgam's activity is not 1, so it stays in the log term.", "stars": 1,
     "srcs": ["S003·6", "T003 00:10:54", "T003 00:11:06"]},
    {"id": "E6.1", "topic": "T6", "title": "Stannic–stannous redox electrode",
     "tex": r"E_{\mathrm{Pt/Sn^{4+}/Sn^{2+}}}=E^\circ_{\mathrm{Pt/Sn^{4+}/Sn^{2+}}}-\frac{0.0591}{2}\log\frac{[\mathrm{Sn^{2+}}]}{[\mathrm{Sn^{4+}}]}",
     "gives": r"Potential of $\mathrm{Pt|Sn^{4+},Sn^{2+}}$.", "when": r"$\mathrm{Sn^{4+}+2e^-\rightleftharpoons Sn^{2+}}$; $n=2$.",
     "units": "V", "note": "Only the ratio [reduced]/[oxidised] matters. $E^\\circ=0.15$ V (given data).", "stars": 2,
     "srcs": ["S003·7", "T003 00:13:31"]},
    {"id": "E6.2", "topic": "T6", "title": "Ferric–ferrous redox electrode",
     "tex": r"\mathrm{Fe^{3+}+e^-\rightleftharpoons Fe^{2+}},\qquad E=E^\circ-0.0591\log\frac{[\mathrm{Fe^{2+}}]}{[\mathrm{Fe^{3+}}]}",
     "gives": r"Potential of $\mathrm{Pt|Fe^{3+},Fe^{2+}}$.", "when": r"$n=1$; $E^\circ=0.77$ V (given data).",
     "units": "V", "note": "The Pt indicator electrode of the potentiometric titration of ferrous iron (lab).", "stars": 2,
     "srcs": ["S003·7", "T003 00:13:05", "PDF p.67"], "flags": [ADD]},
    {"id": "E6.3", "topic": "T6", "title": "Quinhydrone electrode",
     "tex": r"E_{\mathrm{Pt/Q/QH_2}}=E^\circ_{\mathrm{Pt/Q/QH_2}}-\frac{0.0591}{2}\log\frac{[\mathrm{QH_2}]}{[\mathrm{Q}][\mathrm{H^+}]^2},\qquad E^\circ_{\mathrm{Pt/Q/QH_2}}=+0.699\ \mathrm{V}",
     "gives": r"Potential of $\mathrm{Pt|Q,QH_2}$.", "when": r"$\mathrm{Q+2H^++2e^-\rightleftharpoons QH_2}$; $n=2$.",
     "units": "V", "note": r"$\mathrm{H^+}$ is a reactant, so it sits in the denominator, squared.", "stars": 2,
     "srcs": ["S003·8", "T003 00:15:20"]},
    {"id": "E6.4", "topic": "T6", "title": "Quinhydrone electrode in terms of pH",
     "tex": r"[\mathrm{Q}]=[\mathrm{QH_2}]\ \Longrightarrow\ E=0.699+0.0591\log[\mathrm{H^+}]=0.699-0.0591\,\mathrm{pH}",
     "gives": "The pH dependence used to measure pH.", "when": "Quinhydrone dissolved (1 : 1); pH below about 8.",
     "units": "V", "note": r"$\frac{0.0591}{2}\log[\mathrm{H^+}]^2=0.0591\log[\mathrm{H^+}]$.", "stars": 2,
     "srcs": ["S003·8"], "flags": [ADD]},
    {"id": "E7.1", "topic": "T7", "title": "Glass electrode (pH-sensitive ISE)",
     "tex": r"E_G=E^\circ_G+0.0591\log_{10}[\mathrm{H^+}]=E^\circ_G-0.0591\,\mathrm{pH}",
     "gives": "Potential of the glass electrode.", "when": r"Glass membrane selective to $\mathrm{H^+}$; 298 K.",
     "units": "V", "note": r"$E^\circ_G$ differs for each electrode and is found by calibration with a buffer (Unit 3).", "stars": 2,
     "srcs": ["S003·9", "T003 00:17:47", "PDF p.56"]},
    {"id": "E7.2", "topic": "T7", "title": "Glass + calomel cell (PESU form)",
     "tex": r"E_{cell}=E_G-E_{cal}=E^\circ_G-0.0591\,\mathrm{pH}-E_{cal}",
     "gives": "The emf when a glass electrode is coupled with a calomel electrode.", "when": "Calomel written on the left (anode), as in the consolidated PDF.",
     "units": "V", "note": r"The pH numericals that use this are Unit 3 (class 36).", "stars": 2,
     "srcs": ["PDF p.57", "PDF p.58", "ESA Jan-25 s1 2b"], "flags": [NOTCUR]},
]

POINTS = [
    {"topic": "T1", "text": r"Always write the electrode reaction as a <b>reduction</b>, because electrode potentials are reduction "
     r"potentials; the Nernst log term is then products over reactants.", "stars": 2, "srcs": ["T003 00:01:38", "T003 00:07:50"]},
    {"topic": "T1", "text": r"Pure solids and pure metals have activity 1 and drop out of the log term; gases enter as partial pressure "
     r"(atm); amalgams stay in.", "stars": 2, "srcs": ["T003 00:11:06", "T003 00:08:07"]},
    {"topic": "T1", "text": r"0.0591 in the equation means room temperature (298 K): $2.303RT/F$.", "stars": 1, "srcs": ["T003 00:05:12"]},
    {"topic": "T1", "text": r"Three groups: the electrode metal reacts (metal–ion, amalgam, metal–insoluble salt); an inert Pt only "
     r"carries electrons (gas, redox, quinhydrone); a membrane exchanges ions (ion-selective).", "stars": 1, "srcs": ["S003·3", "S003·9"], "flags": [ADD]},
    {"topic": "T2", "text": r"Examples: $\mathrm{Zn|Zn^{2+}}$, $\mathrm{Cu|Cu^{2+}}$, $\mathrm{Ag|Ag^+}$; reaction "
     r"$\mathrm{M^{n+}+ne^-\rightleftharpoons M}$.", "stars": 1, "srcs": ["S003·3", "T003 00:01:13"]},
    {"topic": "T2", "text": r"Increasing $[\mathrm{M^{n+}}]$ tenfold raises $E$ by $0.0591/n$ V.", "stars": 1, "srcs": ["S003·3"], "flags": [ADD]},
    {"topic": "T3", "text": r"The electrode reaction product is $\mathrm{Ag}$, not $\mathrm{Ag^+}$: $\mathrm{AgCl+e^-\rightleftharpoons Ag+Cl^-}$. "
     r"With $\mathrm{Ag^+}$ the equation would not even balance.", "stars": 2, "srcs": ["T003 00:04:20"]},
    {"topic": "T3", "text": r"The solution must contain the anion of the sparingly soluble salt ($\mathrm{Cl^-}$ from KCl or HCl), so "
     r"the potential depends on $[\mathrm{Cl^-}]$: these electrodes are reversible to the anion.", "stars": 2, "srcs": ["T003 00:04:50", "PDF p.33"]},
    {"topic": "T3", "text": r"Construction of $\mathrm{Ag/AgCl}$: a silver wire coated with AgCl dipped in KCl (or HCl), with a porous junction.", "stars": 1, "srcs": ["S003·4", "T003 00:04:34"]},
    {"topic": "T3", "text": r"Both common reference electrodes (calomel and $\mathrm{Ag/AgCl}$) are of this type; class 004 covers them.", "stars": 1, "srcs": ["S003·4", "T003 00:18:34"]},
    {"topic": "T4", "text": r"Pt is chosen because it is inert; platinised (platinum black) foil gives a large surface for the gas–ion equilibrium.", "stars": 2, "srcs": ["S003·5", "T003 00:06:07"]},
    {"topic": "T4", "text": r"The gas must be bubbled into a solution of the ions to which it is reversible: $\mathrm{H_2}$ into $\mathrm{H^+}$, "
     r"$\mathrm{Cl_2}$ into $\mathrm{Cl^-}$.", "stars": 2, "srcs": ["T003 00:06:45", "T003 00:07:03"]},
    {"topic": "T4", "text": r"SHE: $\mathrm{H_2}$ at 1 atm, $[\mathrm{H^+}]=1$ M (1 M HCl), so $E=E^\circ=0$ V; it is the primary reference.", "stars": 2, "srcs": ["S003·5", "T003 00:08:38"]},
    {"topic": "T4", "text": r"Hydrogen electrode: $E=-0.0591\,\mathrm{pH}$ at 1 atm; it becomes more negative by 0.0591 V per pH unit.", "stars": 2, "srcs": ["S003·5"], "flags": [ADD]},
    {"topic": "T5", "text": r"Why amalgamate? Sodium in $\mathrm{Na^+}$ solution reacts vigorously, so no potential can be measured; "
     r"sodium amalgam in $\mathrm{Na^+}$ works, and the mercury content controls the activity.", "stars": 1, "srcs": ["T003 00:10:14", "T003 00:10:36"], "flags": [TONLY]},
    {"topic": "T5", "text": r"The amalgam's activity depends on the percentage of lead, so $[\mathrm{Pb\!-\!Hg}]$ is kept in the log term.", "stars": 1, "srcs": ["T003 00:11:24", "S003·6"]},
    {"topic": "T6", "text": r"Both oxidised and reduced forms must be present in the same solution; Pt picks up the electrons exchanged "
     r"between them.", "stars": 2, "srcs": ["T003 00:12:19", "T003 00:12:36"]},
    {"topic": "T6", "text": r"Unlike the gas electrode, no species is a gas and nothing is bubbled: both forms are ions in solution.", "stars": 2, "srcs": ["S003·5", "S003·7"], "flags": [ADD]},
    {"topic": "T6", "text": r"Quinhydrone: $\mathrm{Q+2H^++2e^-\rightleftharpoons QH_2}$, $E^\circ=+0.699$ V; with $[Q]=[QH_2]$, "
     r"$E=0.699-0.0591\,\mathrm{pH}$, so it measures pH.", "stars": 2, "srcs": ["S003·8", "T003 00:14:35"]},
    {"topic": "T6", "text": r"The quinhydrone electrode is not used above about pH 8, where hydroquinone (a weak acid) ionises and is oxidised by air.", "stars": 1, "srcs": ["S003·8"], "flags": [ADD]},
    {"topic": "T7", "text": r"The membrane is the most important part: it exchanges ions with the solution and so develops a potential "
     r"that depends on the concentration of one ion, even in the presence of other ions.", "stars": 2, "srcs": ["T003 00:16:43", "T003 00:18:14"]},
    {"topic": "T7", "text": r"Glass electrode: used in pH meters, selective to $\mathrm{H^+}$ (sometimes also $\mathrm{Na^+}$, $\mathrm{K^+}$).", "stars": 2, "srcs": ["S003·9", "T003 00:17:07"]},
    {"topic": "T7", "text": r"Other ISEs (older slides): crystalline $\mathrm{LaF_3}$ for $\mathrm{F^-}$, $\mathrm{Ag_2S}$ for $\mathrm{S^{2-}}$; "
     r"liquid-membrane and PVC-immobilised ion exchangers for $\mathrm{Ca^{2+}}$, $\mathrm{K^+}$, $\mathrm{NO_3^-}$.", "stars": 1, "srcs": ["PDF p.45"], "flags": [NOTCUR]},
    {"topic": "T7", "text": r"A glass electrode cannot be used alone: it is coupled with an external reference such as the saturated "
     r"calomel electrode, and the emf of that cell gives the pH (Unit 3).", "stars": 2, "srcs": ["PDF p.57", "ESA Jun-24a 2b", "ESA Jan-25 s1 2b"], "flags": [NOTCUR]},
]

WHY = [
    {"topic": "T2", "q": r"Why is there a + sign in $E=E^\circ+\frac{0.0591}{n}\log[\mathrm{M^{n+}}]$, when the others have −?",
     "a": r"For $\mathrm{M^{n+}+ne^-\rightleftharpoons M}$ the log term is $\log\frac{1}{[\mathrm{M^{n+}}]}=-\log[\mathrm{M^{n+}}]$; "
          r"the two minus signs make +. Every electrode follows the same rule E1.1.", "srcs": ["S003·3", "T003 00:02:15"], "flags": [ADD]},
    {"topic": "T4", "q": "Why use a partial pressure for hydrogen?",
     "a": r"$\mathrm{H_2}$ is a gas; the activity of a gas is its partial pressure in atm. So the log term is $p_{H_2}/[\mathrm{H^+}]^2$.",
     "srcs": ["T003 00:08:07", "T003 00:08:20"]},
    {"topic": "T4", "q": "Why is the metal in a gas electrode platinum?",
     "a": "It must not react; it only conducts electrons and catalyses the gas–ion equilibrium on its (platinised) surface.",
     "srcs": ["S003·5", "T003 00:06:25"]},
    {"topic": "T6", "q": r"Why does the quinhydrone potential depend on pH, while $\mathrm{Pt|Sn^{4+},Sn^{2+}}$ does not?",
     "a": r"$\mathrm{H^+}$ takes part in the quinone reaction ($\mathrm{Q+2H^++2e^-\rightleftharpoons QH_2}$), so it appears in the "
          r"Nernst equation; the tin reaction involves no $\mathrm{H^+}$.", "srcs": ["S003·8", "T003 00:14:35"]},
    {"topic": "T7", "q": "Why is it called ion-selective?",
     "a": "The membrane exchanges one particular ion, so the electrode responds to that ion's concentration and ignores (mostly) the others.",
     "srcs": ["T003 00:16:05", "T003 00:16:25"]},
]

TRAPS = [
    {"topic": "T3", "text": r"Writing $\mathrm{AgCl+e^-\rightleftharpoons Ag^++Cl^-}$ is wrong (and unbalanced in charge); the product is metallic $\mathrm{Ag}$.", "srcs": ["T003 00:04:20"]},
    {"topic": "T3", "text": r"The Ag/AgCl and calomel potentials fall as $[\mathrm{Cl^-}]$ rises (minus sign); students often write +.", "srcs": ["S003·4"], "flags": [ADD]},
    {"topic": "T4", "text": r"Forgetting the square: the log term is $p_{H_2}/[\mathrm{H^+}]^2$, not $p_{H_2}/[\mathrm{H^+}]$; with $n=2$ the "
     r"pH term becomes $0.0591\,\mathrm{pH}$, not $0.0591\,\mathrm{pH}/2$.", "srcs": ["T003 00:08:20"]},
    {"topic": "T6", "text": r"In the redox Nernst equation the reduced form goes on top: $\log\frac{[\mathrm{Sn^{2+}}]}{[\mathrm{Sn^{4+}}]}$. "
     r"Inverting it flips the sign of the correction.", "srcs": ["S003·7", "T003 00:13:49"]},
    {"topic": "T6", "text": r"The gas and redox electrodes both use inert Pt; in a 2-mark note on either, say what Pt does (contact only) and what sets the potential (gas–ion equilibrium vs the ratio of the two ionic forms).", "srcs": ["ESA Dec-23 2d"], "flags": [ADD]},
    {"topic": "T7", "text": r"Slide form $E_G=E^\circ_G+0.0591\log[\mathrm{H^+}]$ and pH form $E^\circ_G-0.0591\,\mathrm{pH}$ are the same; mixing the "
     r"sign of the pH term is the commonest error in the Unit 3 numericals.", "srcs": ["S003·9", "PDF p.56"]},
    {"topic": "T7", "text": r"In the glass + calomel cell, write $E_{cell}$ to match your diagram: calomel on the left gives "
     r"$E_{cell}=E_G-E_{cal}$ (PESU slides); glass on the left gives $E_{cell}=E_{cal}-E_G$.", "srcs": ["PDF p.57"], "flags": [ADD]},
]

WORKED = [
    {"id": "W2.1", "topic": "T2", "title": r"Zinc electrode in 0.01 M $\mathrm{Zn^{2+}}$", "srcs": ["S003·3"], "stars": 1, "flags": [ADD],
     "given": r"$\mathrm{Zn|Zn^{2+}(0.01\,M)}$, $E^\circ_{\mathrm{Zn^{2+}/Zn}}=-0.76$ V (given), 298 K.",
     "steps": [r"$\mathrm{Zn^{2+}+2e^-\rightleftharpoons Zn}$, $n=2$.",
               r"$E=E^\circ+\frac{0.0591}{2}\log[\mathrm{Zn^{2+}}]=-0.76+0.02955\log0.01=-0.76+0.02955(-2)$."],
     "answer": r"$E=-0.8191$ V", "check": "sympy: −0.819100 V. Dilution makes the electrode more negative."},
    {"id": "W3.1", "topic": "T3", "title": r"$\mathrm{Ag/AgCl}$ electrode at $[\mathrm{Cl^-}]=0.1$ M", "srcs": ["S003·4", "PDF p.67"], "stars": 2,
     "given": r"$\mathrm{Ag|AgCl(s)|Cl^-(0.1\,M)}$, $E^\circ_{\mathrm{Ag/AgCl/Cl^-}}=0.222$ V (given), 298 K.",
     "steps": [r"$\mathrm{AgCl+e^-\rightleftharpoons Ag+Cl^-}$, $n=1$.",
               r"$E=0.222-0.0591\log[\mathrm{Cl^-}]=0.222-0.0591\log0.1=0.222+0.0591$."],
     "answer": r"$E=0.2811$ V", "check": r"sympy: 0.281100 V. Lower $[\mathrm{Cl^-}]$ than 1 M, so $E>E^\circ$."},
    {"id": "W4.1", "topic": "T4", "title": "Hydrogen electrode at pH 3 and 2 atm", "srcs": ["S003·5", "T003 00:07:50"], "stars": 2,
     "given": r"$\mathrm{Pt|H_2(2\,atm)|H^+}$, pH = 3 so $[\mathrm{H^+}]=10^{-3}$ M; $E^\circ=0$.",
     "steps": [r"$\mathrm{2H^++2e^-\rightleftharpoons H_2}$, $n=2$.",
               r"$E=0-\frac{0.0591}{2}\log\frac{p_{H_2}}{[\mathrm{H^+}]^2}=-0.02955\log\frac{2}{10^{-6}}$.",
               r"$\log(2\times10^6)=6.3010$, so $E=-0.02955\times6.3010$.",
               r"Split: pH part $-0.0591\times3=-0.1773$ V; pressure part $-0.02955\log2=-0.0089$ V."],
     "answer": r"$E=-0.1862$ V", "check": "sympy: −0.186195 V; both routes agree (E4.2)."},
    {"id": "W4.2", "topic": "T4", "title": "Chlorine electrode", "srcs": ["S003·5"], "stars": 1, "flags": [ADD],
     "given": r"$\mathrm{Pt|Cl_2(1\,atm)|Cl^-(0.01\,M)}$, $E^\circ=1.36$ V (given).",
     "steps": [r"$\mathrm{Cl_2+2e^-\rightleftharpoons 2Cl^-}$, $n=2$.",
               r"$E=1.36-\frac{0.0591}{2}\log\frac{(0.01)^2}{1}=1.36-0.02955(-4)=1.36+0.1182$."],
     "answer": r"$E=1.4782$ V", "check": "sympy: 1.47820 V."},
    {"id": "W5.1", "topic": "T5", "title": "Lead amalgam electrode", "srcs": ["S003·6"], "stars": 1, "flags": [ADD],
     "given": r"$\mathrm{Pb\!-\!Hg|Pb^{2+}(0.01\,M)}$ with lead activity in the amalgam 0.5; take "
              r"$E^\circ_{\mathrm{Pb^{2+}/Pb\text{-}Hg}}=-0.120$ V (given, illustrative).",
     "steps": [r"$\mathrm{Pb^{2+}+2e^-\rightleftharpoons Pb(Hg)}$, $n=2$.",
               r"$E=E^\circ-\frac{0.0591}{2}\log\frac{[\mathrm{Pb\text{-}Hg}]}{[\mathrm{Pb^{2+}}]}=-0.120-0.02955\log\frac{0.5}{0.01}$.",
               r"$\log50=1.6990$, so the correction is $-0.0502$ V."],
     "answer": r"$E=-0.1702$ V", "check": "sympy: −0.170205 V. With activity 1 (pure metal) the amalgam term would vanish."},
    {"id": "W6.1", "topic": "T6", "title": r"$\mathrm{Pt|Sn^{4+},Sn^{2+}}$ with a given ratio", "srcs": ["S003·7", "T003 00:13:49"], "stars": 2,
     "given": r"$[\mathrm{Sn^{4+}}]=0.1$ M, $[\mathrm{Sn^{2+}}]=0.01$ M, so $[\mathrm{Sn^{2+}}]/[\mathrm{Sn^{4+}}]=0.1$; "
              r"$E^\circ=0.15$ V (given).",
     "steps": [r"$\mathrm{Sn^{4+}+2e^-\rightleftharpoons Sn^{2+}}$, $n=2$.",
               r"$E=0.15-\frac{0.0591}{2}\log\frac{[\mathrm{Sn^{2+}}]}{[\mathrm{Sn^{4+}}]}=0.15-0.02955\log0.1=0.15+0.02955$."],
     "answer": r"$E=0.1796$ V", "check": r"sympy: 0.179550 V. If the ratio were reversed (10), $E=0.1205$ V."},
    {"id": "W6.2", "topic": "T6", "title": r"$\mathrm{Pt|Fe^{3+},Fe^{2+}}$ electrode", "srcs": ["S003·7", "PDF p.67"], "stars": 2, "flags": [ADD],
     "given": r"$[\mathrm{Fe^{3+}}]=0.1$ M, $[\mathrm{Fe^{2+}}]=0.01$ M, $E^\circ=0.77$ V (given).",
     "steps": [r"$\mathrm{Fe^{3+}+e^-\rightleftharpoons Fe^{2+}}$, $n=1$.",
               r"$E=0.77-0.0591\log\frac{0.01}{0.1}=0.77+0.0591$."],
     "answer": r"$E=0.8291$ V", "check": r"sympy: 0.829100 V. $n=1$ doubles the correction compared with the tin couple."},
    {"id": "W6.3", "topic": "T6", "title": "Quinhydrone electrode at pH 4", "srcs": ["S003·8", "T003 00:15:20"], "stars": 2,
     "given": r"$\mathrm{Pt|Q,QH_2}$ in a solution of pH 4 saturated with quinhydrone ($[Q]=[\mathrm{QH_2}]$); $E^\circ=0.699$ V.",
     "steps": [r"$\mathrm{Q+2H^++2e^-\rightleftharpoons QH_2}$, $n=2$.",
               r"$E=0.699-\frac{0.0591}{2}\log\frac{[\mathrm{QH_2}]}{[\mathrm{Q}][\mathrm{H^+}]^2}=0.699-\frac{0.0591}{2}\log\frac{1}{(10^{-4})^2}$.",
               r"$=0.699-0.02955\times8=0.699-0.0591\times4$."],
     "answer": r"$E=0.4626$ V", "check": "sympy: 0.462600 V by both routes (E6.3 and E6.4)."},
    {"id": "W6.4", "topic": "T6", "title": "Model answer: notes on redox and gas electrodes (4 marks)", "srcs": ["S003·5", "S003·7", "ESA Dec-23 2d"], "stars": 2,
     "given": "ESA Dec 2023 Q2.d: Write a note on (i) oxidation–reduction electrodes (2M), (ii) gas electrode (2M).",
     "steps": [r"(i) Inert Pt immersed in a solution containing the oxidised and reduced forms of a redox system; Pt is only an electrical contact; the potential arises from the tendency of one form to change into the other. Example $\mathrm{Pt|Sn^{4+},Sn^{2+}}$: $\mathrm{Sn^{4+}+2e^-\rightleftharpoons Sn^{2+}}$, $E=E^\circ-\frac{0.0591}{2}\log\frac{[\mathrm{Sn^{2+}}]}{[\mathrm{Sn^{4+}}]}$.",
               r"(ii) A gas bubbled about an inert Pt foil immersed in a solution of the ions to which the gas is reversible; Pt gives contact and helps establish the gas–ion equilibrium. Example $\mathrm{Pt|H_2|H^+}$: $\mathrm{2H^++2e^-\rightleftharpoons H_2}$, $E=E^\circ-\frac{0.0591}{2}\log\frac{p_{H_2}}{[\mathrm{H^+}]^2}$; SHE $E=0$."],
     "answer": "Definition + representation + reaction + Nernst equation for each (sketch G4.1 / G6.1 if time allows)", "check": "Every line is the slide wording of S003·5 and S003·7."},
    {"id": "W7.1", "topic": "T7", "title": "ISE definition and the glass | SCE cell", "srcs": ["S003·9", "PDF p.57", "ESA Jun-24a 2b", "ESA Jan-25 s1 2b"], "stars": 2,
     "flags": [NOTCUR],
     "given": "ESA: What is an ion-selective electrode? Write the cell representation when a glass electrode is coupled with a saturated calomel electrode. (2 marks)",
     "steps": [r"Definition: an electrode with a membrane in contact with the solution with which it can exchange ions; it responds "
               r"selectively to one ion in the presence of others, e.g. the glass electrode (selective to $\mathrm{H^+}$).",
               r"Cell (PESU form): $\mathrm{Hg\,|\,Hg_2Cl_2(s)\,|\,KCl(sat)\,||\,H^+(test\ solution)\,|\,glass\,|\,0.1\,M\,HCl\,|\,AgCl(s)\,|\,Ag}$.",
               r"Emf: $E_{cell}=E_G-E_{SCE}=E^\circ_G-0.0591\,\mathrm{pH}-E_{SCE}$."],
     "answer": r"ISE as defined; cell as in step 2 (SCE anode, glass cathode)", "check": "Matches the consolidated PDF p.57–58. The pH calculation that follows in both papers is Unit 3."},
]

PYQS = [
    {"topic": "T6", "paper": "ESA Dec 2023", "q": "UE22CY151B/A set 1, Q2.d", "marks": 4,
     "text": "Write a note on the following types of electrodes: i. Oxidation-reduction electrodes (2M) ii. Gas electrode (2M).", "worked": "W6.4"},
    {"topic": "T7", "paper": "ESA Jun 2024 (a)", "q": "UE23CY151B/A set 1, Q2.b(i)", "marks": 2,
     "text": "What is ion selective electrode? Write the cell representation when a glass electrode is coupled with a calomel electrode. (Part (ii), the pH numerical, is Unit 3.)", "worked": "W7.1"},
    {"topic": "T7", "paper": "ESA Jan 2025", "q": "UE24CY151A set 1, Q2.b(i)", "marks": 2,
     "text": "What is ion selective electrode? Write the cell representation when a glass electrode is coupled with a saturated calomel electrode. (Part (ii), the pH numerical, is Unit 3.)", "worked": "W7.1"},
]

NOTES = [
    {"topic": "T1", "text": r"A cell needs two electrodes; the type depends on the application. Six types: metal–metal ion, "
     r"metal–insoluble salt–anion, gas, amalgam, redox (quinhydrone a special case), ion-selective. For each, write the reduction "
     r"reaction and $E=E^\circ-\frac{0.0591}{n}\log\frac{[\text{products}]}{[\text{reactants}]}$ (solids 1, gases as $p$)."},
    {"topic": "T2", "text": r"Metal in contact with a solution of its own ions ($\mathrm{Zn|Zn^{2+}}$, $\mathrm{Cu|Cu^{2+}}$, "
     r"$\mathrm{Ag|Ag^+}$). $\mathrm{M^{n+}+ne^-\rightleftharpoons M}$; $E=E^\circ+\frac{2.303RT}{nF}\log[\mathrm{M^{n+}}]$."},
    {"topic": "T3", "text": r"Metal + sparingly soluble salt of the metal, in a solution of a soluble salt of the same anion. "
     r"Calomel $\mathrm{Hg|Hg_2Cl_2|KCl}$; $\mathrm{Ag|AgCl(s)|HCl}$: $\mathrm{AgCl+e^-\rightleftharpoons Ag+Cl^-}$, "
     r"$E=E^\circ-0.0591\log[\mathrm{Cl^-}]$. Reversible to the anion; used as reference electrodes."},
    {"topic": "T4", "text": r"Gas bubbled over inert Pt foil in a solution of the ions to which the gas is reversible; Pt gives "
     r"contact and helps set up the gas–ion equilibrium. $\mathrm{Pt|H_2|H^+}$: $\mathrm{2H^++2e^-\rightleftharpoons H_2}$, "
     r"$E=E^\circ-\frac{0.0591}{2}\log\frac{p_{H_2}}{[H^+]^2}$; SHE ($1$ atm, 1 M) $E=0$. Also $\mathrm{Pt|Cl_2|Cl^-}$."},
    {"topic": "T5", "text": r"Like the metal–metal ion electrode but with the metal as an amalgam: $\mathrm{Pb\!-\!Hg|Pb^{2+}}$, "
     r"$E=E^\circ-\frac{0.0591}{2}\log\frac{[\mathrm{Pb\text{-}Hg}]}{[\mathrm{Pb^{2+}}]}$. Amalgamation tames reactive metals (Na) "
     r"and lets the activity be controlled."},
    {"topic": "T6", "text": r"Inert Pt in a solution of both forms of a redox couple ($\mathrm{Fe^{3+}/Fe^{2+}}$, "
     r"$\mathrm{Ce^{4+}/Ce^{3+}}$, $\mathrm{Sn^{4+}/Sn^{2+}}$); Pt is only a contact; potential from the tendency of one form to "
     r"change into the other: $E=E^\circ-\frac{0.0591}{2}\log\frac{[\mathrm{Sn^{2+}}]}{[\mathrm{Sn^{4+}}]}$. Quinhydrone "
     r"$\mathrm{Pt|Q,QH_2}$: $E^\circ=0.699$ V, $E=0.699-0.0591\,\mathrm{pH}$."},
    {"topic": "T7", "text": r"An ISE has a membrane that exchanges ions with the solution, so its potential depends on one ion's "
     r"concentration in the presence of others. Glass electrode (pH meters): $E_G=E^\circ_G+0.0591\log[\mathrm{H^+}]=E^\circ_G-0.0591\,\mathrm{pH}$. "
     r"With SCE: $\mathrm{Hg|Hg_2Cl_2|KCl(sat)||H^+|glass|0.1\,M\,HCl|AgCl|Ag}$."},
]

FIGS = [
    {"id": "G2.1", "topic": "T2", "title": r"Metal–metal ion electrode ($\mathrm{Zn|Zn^{2+}}$)", "stars": 1, "srcs": ["S003·3", "T003 00:01:26"],
     "howto": "A zinc rod dips in a solution of its own ions. The potential develops at the rod–solution interface (marked +). Label: metal rod, solution of its own ions, the interface; write the reaction and the representation under it. Schematic, not to scale."},
    {"id": "G3.1", "topic": "T3", "title": r"Silver–silver chloride electrode", "stars": 1, "srcs": ["S003·4", "T003 00:04:34"],
     "howto": "A silver wire, its lower end coated with AgCl, sits in KCl (or HCl) inside a glass tube that meets the outer solution through a porous junction. The three labels to remember: metal, sparingly soluble salt of the metal, soluble salt of the same anion."},
    {"id": "G4.1", "topic": "T4", "title": "Standard hydrogen electrode (a gas electrode)", "stars": 2, "srcs": ["S003·5", "T003 00:05:49"],
     "howto": "Hydrogen at 1 atm enters a glass hood and bubbles over a platinised Pt foil dipped in 1 M HCl; the Pt wire leads out to the connection. Label: $\\mathrm{H_2}$ inlet, Pt wire, platinised foil, 1 M $\\mathrm{H^+}$, bubbles. Redrawn from the deck's figure; schematic."},
    {"id": "G5.1", "topic": "T5", "title": "Lead amalgam electrode", "stars": 1, "srcs": ["S003·6"],
     "howto": "A pellet of lead amalgam at the end of a glass tube (with a contact wire) dips in a solution of $\\mathrm{Pb^{2+}}$. It is a metal–metal ion electrode with the metal replaced by its amalgam. Simplified from the deck's figure."},
    {"id": "G6.1", "topic": "T6", "title": r"Redox electrode $\mathrm{Pt|Sn^{4+},Sn^{2+}}$", "stars": 2, "srcs": ["S003·7", "T003 00:12:19"],
     "howto": "An inert Pt rod dips in a solution containing both $\\mathrm{Sn^{4+}}$ (oxidised, vermilion) and $\\mathrm{Sn^{2+}}$ (reduced, blue). Electrons exchanged between the two forms pass through the Pt (green arrow); the Pt itself does not react."},
    {"id": "G6.2", "topic": "T6", "title": "Potential against pH: hydrogen, quinhydrone and glass electrodes", "stars": 2, "srcs": ["S003·5", "S003·8", "S003·9"], "flags": [ADD],
     "howto": "All three lines have slope −0.0591 V per pH unit at 298 K; they differ only in the intercept: 0 V (hydrogen, 1 atm), 0.699 V (quinhydrone), and $E^\\circ_G$ (glass, illustrative value here). The dot is W6.3. The grey line marks the pH-8 limit of the quinhydrone electrode."},
    {"id": "G7.1", "topic": "T7", "title": "Glass electrode (simplified)", "stars": 2, "srcs": ["S003·9", "PDF p.56"],
     "howto": "A glass tube ends in a thin pH-sensitive glass bulb (the membrane). Inside: 0.1 M HCl and an Ag/AgCl wire as the internal reference. The bulb dips in the test solution and is paired with an external reference such as the SCE. Construction details are taught in Unit 3."},
]

FLOWS = [
    {"id": "F1.1", "topic": "T1", "title": "Classification of electrodes (the six types in three groups).", "stars": 2,
     "srcs": ["S003·3", "S003·4", "S003·5", "S003·6", "S003·7", "S003·8", "S003·9", "T003 00:00:16"], "flags": [ADD],
     "layout": "tree", "maxw": "178mm",
     "spec": {"root": {"kind": "given", "title": "Types of electrodes", "sub": "six types on the deck"},
              "branches": [
                  {"title": "The electrode metal reacts", "sub": "metal is part of the couple",
                   "rows": [["1 Metal–metal ion", r"$\mathrm{Zn}$ | $\mathrm{Zn^{2+}}$"], ["4 Amalgam", r"$\mathrm{Pb\!-\!Hg}$ | $\mathrm{Pb^{2+}}$"],
                            ["2 Metal–insoluble salt–anion", r"$\mathrm{Ag}$ | $\mathrm{AgCl}$ | $\mathrm{Cl^-}$; calomel"]]},
                  {"title": "Inert Pt: contact only", "sub": "couple is in solution or gas",
                   "rows": [["3 Gas", r"$\mathrm{Pt}$ | $\mathrm{H_2}$ | $\mathrm{H^+}$; $\mathrm{Pt}$ | $\mathrm{Cl_2}$ | $\mathrm{Cl^-}$"],
                            ["5 Redox", r"$\mathrm{Pt}$ | $\mathrm{Fe^{3+}}$, $\mathrm{Fe^{2+}}$"],
                            ["5 Quinhydrone", r"$\mathrm{Pt}$ | $\mathrm{Q}$, $\mathrm{QH_2}$"]]},
                  {"title": "Membrane exchanges ions", "sub": "selective to one ion",
                   "rows": [["6 Ion-selective", r"glass ($\mathrm{H^+}$)"], ["other ISEs", r"$\mathrm{LaF_3}$ ($\mathrm{F^-}$)"]]}]},
     "remark": "The three groups are added for clarity; the numbers are the deck's. The quinhydrone electrode is a special case of type 5."},
    {"id": "F1.2", "topic": "T1", "title": "Writing the Nernst equation for any electrode.", "stars": 2,
     "srcs": ["T003 00:01:38", "T003 00:07:50", "T003 00:11:06"],
     "layout": "straight", "maxw": "130mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "An electrode, e.g. $\\mathrm{Pt|H_2(p)|H^+}$", "sub": "concentrations, pressures, $E^\\circ$"},
         {"kind": "step", "n": 1, "title": "Write the reduction reaction", "fx": "$\\mathrm{2H^++2e^-\\rightleftharpoons H_2}$"},
         {"kind": "step", "n": 2, "title": "Read off $n$", "fx": "$n=2$"},
         {"kind": "step", "n": 3, "title": "Products over reactants", "sub": "pure solid or metal = 1; gas = $p$ (atm); amalgam stays; powers = coefficients",
          "fx": "$\\dfrac{p_{H_2}}{[\\mathrm{H^+}]^2}$"},
         {"kind": "step", "n": 4, "title": "Substitute", "fx": "$E=E^\\circ-\\dfrac{0.0591}{n}\\log(\\dots)$"},
         {"kind": "result", "title": "Electrode potential", "fx": "$E$ in volts (reduction potential)"}]},
     "trap": "Writing the oxidation instead of the reduction flips the log term and gives the wrong sign."},
    {"id": "F1.3", "topic": "T1", "title": "Which type is this electrode? (from its representation)", "stars": 1,
     "srcs": ["S003·3", "S003·4", "S003·5", "S003·6", "S003·7", "S003·9"],
     "layout": "route", "maxw": "165mm",
     "spec": {"question": "What touches the solution?",
              "rows": [{"title": "A metal, in its own ions", "sub": "$\\mathrm{Cu|Cu^{2+}}$", "kw": "metal–metal ion"},
                       {"title": "A metal amalgam, in its own ions", "sub": "$\\mathrm{Na\\!-\\!Hg|Na^+}$", "kw": "amalgam"},
                       {"title": "A metal + its insoluble salt, in the salt's anion", "sub": "$\\mathrm{Hg|Hg_2Cl_2|Cl^-}$", "kw": "metal–insoluble salt"},
                       {"title": "Pt with a gas bubbled over it", "sub": "$\\mathrm{Pt|Cl_2|Cl^-}$", "kw": "gas"},
                       {"title": "Pt in two ionic forms of one element", "sub": "$\\mathrm{Pt|Ce^{4+},Ce^{3+}}$; quinhydrone", "kw": "redox"},
                       {"title": "A membrane exchanging one ion", "sub": "glass bulb", "kw": "ion-selective"}]},
     "remark": "Pt never takes part in the reaction; if Pt appears, the electrode is gas or redox."},
    {"id": "F6.1", "topic": "T6", "title": "Potential of a quinhydrone electrode from pH.", "stars": 2, "srcs": ["S003·8"],
     "layout": "straight", "maxw": "120mm",
     "spec": {"nodes": [
         {"kind": "given", "title": "$\\mathrm{Pt|Q,QH_2}$ in a solution of pH 4", "sub": "saturated with quinhydrone: $[Q]=[\\mathrm{QH_2}]$"},
         {"kind": "step", "n": 1, "title": "Reaction", "fx": "$\\mathrm{Q+2H^++2e^-\\rightleftharpoons QH_2}$, $n=2$"},
         {"kind": "step", "n": 2, "title": "Nernst with $[Q]=[\\mathrm{QH_2}]$", "fx": "$E=0.699-\\tfrac{0.0591}{2}\\log\\tfrac{1}{[\\mathrm{H^+}]^2}=0.699-0.0591\\,\\mathrm{pH}$"},
         {"kind": "result", "title": "pH 4", "fx": "$E=0.699-0.2364=0.4626$ V"}]},
     "remark": "Run it backwards to measure pH: $\\mathrm{pH}=(0.699-E)/0.0591$ (valid below about pH 8)."},
]

COMPARISONS = [
    {"id": "C1.1", "topic": "T1", "title": "The six types of electrodes at a glance", "srcs": ["S003·3", "S003·4", "S003·5", "S003·6", "S003·7", "S003·8", "S003·9"],
     "head": ["Type (responds to)", "Representation", "Electrode reaction", "Nernst equation, 298 K"],
     "rows": [[r"1 Metal–metal ion<br><i>(cation)</i>", r"$\mathrm{Zn|Zn^{2+}}$", r"$\mathrm{M^{n+}+ne^-\rightleftharpoons M}$", r"$E^\circ+\frac{0.0591}{n}\log[\mathrm{M^{n+}}]$"],
              [r"2 Metal–insoluble salt–anion<br><i>(anion)</i>", r"$\mathrm{Ag|AgCl(s)|Cl^-}$", r"$\mathrm{AgCl+e^-\rightleftharpoons Ag+Cl^-}$", r"$E^\circ-0.0591\log[\mathrm{Cl^-}]$"],
              [r"3 Gas<br><i>($\mathrm{H^+}$, $p$)</i>", r"$\mathrm{Pt|H_2|H^+}$", r"$\mathrm{2H^++2e^-\rightleftharpoons H_2}$", r"$E^\circ-\frac{0.0591}{2}\log\frac{p_{H_2}}{[\mathrm{H^+}]^2}$"],
              [r"4 Amalgam<br><i>(cation, amalgam)</i>", r"$\mathrm{Pb\!-\!Hg|Pb^{2+}}$", r"$\mathrm{Pb^{2+}+2e^-\rightleftharpoons Pb(Hg)}$", r"$E^\circ-\frac{0.0591}{2}\log\frac{[\mathrm{Pb\text{-}Hg}]}{[\mathrm{Pb^{2+}}]}$"],
              [r"5 Redox<br><i>(ratio red/ox)</i>", r"$\mathrm{Pt|Sn^{4+},Sn^{2+}}$", r"$\mathrm{Sn^{4+}+2e^-\rightleftharpoons Sn^{2+}}$", r"$E^\circ-\frac{0.0591}{2}\log\frac{[\mathrm{Sn^{2+}}]}{[\mathrm{Sn^{4+}}]}$"],
              [r"5 Quinhydrone<br><i>(pH)</i>", r"$\mathrm{Pt|Q,QH_2}$", r"$\mathrm{Q+2H^++2e^-\rightleftharpoons QH_2}$", r"$0.699-\frac{0.0591}{2}\log\frac{[\mathrm{QH_2}]}{[Q][\mathrm{H^+}]^2}$"],
              [r"6 Ion-selective (glass)<br><i>(one ion, $\mathrm{H^+}$)</i>", "glass membrane", r"ion exchange at the membrane", r"$E^\circ_G+0.0591\log[\mathrm{H^+}]$"]]},
    {"id": "C6.1", "topic": "T6", "title": "Gas electrode vs redox electrode (ESA Dec 2023 note)", "srcs": ["S003·5", "S003·7", "ESA Dec-23 2d"],
     "head": ["", "Gas electrode", "Oxidation–reduction electrode"],
     "rows": [["Construction", "Gas bubbled over inert Pt foil in a solution of its ions", "Inert Pt in a solution of both oxidised and reduced forms"],
              ["Role of Pt", "Contact; helps set up gas–ion equilibrium", "Contact only"],
              ["Example", r"$\mathrm{Pt|H_2|H^+}$, $\mathrm{Pt|Cl_2|Cl^-}$", r"$\mathrm{Pt|Fe^{3+},Fe^{2+}}$, $\mathrm{Pt|Sn^{4+},Sn^{2+}}$"],
              ["Reaction", r"$\mathrm{2H^++2e^-\rightleftharpoons H_2}$", r"$\mathrm{Sn^{4+}+2e^-\rightleftharpoons Sn^{2+}}$"],
              ["Nernst", r"$E^\circ-\frac{0.0591}{2}\log\frac{p_{H_2}}{[\mathrm{H^+}]^2}$", r"$E^\circ-\frac{0.0591}{2}\log\frac{[\mathrm{Sn^{2+}}]}{[\mathrm{Sn^{4+}}]}$"],
              ["Potential set by", r"$[\mathrm{H^+}]$ and gas pressure", "ratio [reduced]/[oxidised]"]]},
    {"id": "C7.1", "topic": "T7", "title": "Three electrodes whose potential depends on pH", "srcs": ["S003·5", "S003·8", "S003·9"], "flags": [ADD],
     "head": ["", "Hydrogen", "Quinhydrone", "Glass"],
     "rows": [["Type", "gas", "redox (special case)", "ion-selective"],
              [r"$E$ at 298 K", r"$-0.0591\,\mathrm{pH}$ (1 atm)", r"$0.699-0.0591\,\mathrm{pH}$", r"$E^\circ_G-0.0591\,\mathrm{pH}$"],
              ["Needs", r"$\mathrm{H_2}$ gas, platinised Pt", "quinhydrone, Pt", "glass bulb + reference"],
              ["Limit", "poisoned easily; awkward gas supply", "not above pH 8", "calibrate $E^\\circ_G$ with a buffer"]]},
]

SYMBOLS = [
    {"sym": "$E$", "name": "Electrode potential", "meaning": "Reduction potential of the electrode at the given concentrations", "unit": "V", "where": "E1.1–E7.1"},
    {"sym": "$E^\\circ$", "name": "Standard electrode potential", "meaning": "$E$ with all activities 1 (1 M, 1 atm)", "unit": "V", "where": "E1.1–E6.3"},
    {"sym": "$E_G$, $E^\\circ_G$", "name": "Glass electrode potential", "meaning": "$E^\\circ_G$ is a constant of each glass electrode", "unit": "V", "where": "E7.1, E7.2"},
    {"sym": "$E_{cal}$, $E_{SCE}$", "name": "Calomel potential", "meaning": "Saturated calomel 0.2422 V (PDF; papers use 0.2412–0.244 V)", "unit": "V", "where": "E3.2, E7.2"},
    {"sym": "$n$", "name": "Electrons transferred", "meaning": "From the balanced reduction reaction", "unit": "—", "where": "E1.1–E6.3"},
    {"sym": "$R$, $T$, $F$", "name": "Gas constant, temperature, Faraday", "meaning": "8.314 J/(K mol), 298 K, 96485 C/mol; $2.303RT/F=0.0591$ V", "unit": "", "where": "E1.1, E2.1"},
    {"sym": "$[\\ ]$", "name": "Concentration", "meaning": "Molar concentration (strictly activity)", "unit": "mol/L", "where": "all"},
    {"sym": "$p_{\\mathrm{H_2}}$, $p_{\\mathrm{Cl_2}}$", "name": "Partial pressure", "meaning": "Activity of a gas", "unit": "atm", "where": "E4.1–E4.3"},
    {"sym": "$\\mathrm{pH}$", "name": "pH", "meaning": "$-\\log[\\mathrm{H^+}]$", "unit": "—", "where": "E4.2, E6.4, E7.1"},
    {"sym": "$\\mathrm{Q}$, $\\mathrm{QH_2}$", "name": "Quinone, hydroquinone", "meaning": "Oxidised and reduced forms in the quinhydrone electrode (not a reaction quotient)", "unit": "", "where": "E6.3, E6.4"},
    {"sym": "$\\mathrm{Pb\\text{-}Hg}$", "name": "Lead amalgam", "meaning": "Lead dissolved in mercury; activity below 1", "unit": "", "where": "E5.1"},
    {"sym": "$|$ and $||$", "name": "Phase boundary, salt bridge", "meaning": "Single bar separates phases; double bar a salt bridge or junction", "unit": "", "where": "E7.2, W7.1"},
]

KEYWORDS = [
    {"term": "Amalgam", "meaning": "Alloy of a metal with mercury.", "topic": "T5"},
    {"term": "Amalgam electrode", "meaning": r"$\mathrm{Pb\!-\!Hg|Pb^{2+}}$; metal–ion electrode with an amalgam.", "topic": "T5"},
    {"term": "Calomel electrode", "meaning": r"$\mathrm{Hg|Hg_2Cl_2|KCl}$; metal–insoluble salt type; reference.", "topic": "T3"},
    {"term": "Chlorine electrode", "meaning": r"$\mathrm{Pt|Cl_2|Cl^-}$; gas electrode.", "topic": "T4"},
    {"term": "Electrical contact", "meaning": "The only role of Pt in redox electrodes.", "topic": "T6"},
    {"term": "Gas electrode", "meaning": "Gas bubbled over inert Pt in a solution of its ions.", "topic": "T4"},
    {"term": "Glass electrode", "meaning": r"ISE selective to $\mathrm{H^+}$; $E_G=E^\circ_G-0.0591\,\mathrm{pH}$.", "topic": "T7"},
    {"term": "Hydrogen electrode", "meaning": r"$\mathrm{Pt|H_2|H^+}$; $\mathrm{2H^++2e^-\rightleftharpoons H_2}$.", "topic": "T4"},
    {"term": "Inert metal", "meaning": "Pt: conducts, does not react.", "topic": "T4"},
    {"term": "Ion-selective electrode", "meaning": "Membrane exchanges one ion; potential depends on that ion.", "topic": "T7"},
    {"term": "Membrane electrode", "meaning": "Another name for an ion-selective electrode.", "topic": "T7"},
    {"term": "Metal–metal ion electrode", "meaning": "Metal in a solution of its own ions.", "topic": "T2"},
    {"term": "Metal–insoluble salt–anion electrode", "meaning": "Metal + sparingly soluble salt, in a solution of the same anion.", "topic": "T3"},
    {"term": "Nernst equation", "meaning": r"$E=E^\circ-\frac{0.0591}{n}\log\frac{[\text{products}]}{[\text{reactants}]}$.", "topic": "T1"},
    {"term": "Partial pressure", "meaning": "How a gas enters the Nernst equation.", "topic": "T4"},
    {"term": "Platinised platinum", "meaning": "Pt coated with platinum black; large surface.", "topic": "T4"},
    {"term": "Porous junction", "meaning": "Contact between an electrode's solution and the outer solution.", "topic": "T3"},
    {"term": "Quinhydrone electrode", "meaning": r"$\mathrm{Pt|Q,QH_2}$; $E^\circ=0.699$ V; pH dependent.", "topic": "T6"},
    {"term": "Redox electrode", "meaning": "Pt in both oxidised and reduced forms of a couple.", "topic": "T6"},
    {"term": "Reduction reaction", "meaning": "Always the form in which an electrode reaction is written.", "topic": "T1"},
    {"term": "Saturated calomel electrode (SCE)", "meaning": "Calomel in saturated KCl, 0.2422 V.", "topic": "T7"},
    {"term": "Silver–silver chloride electrode", "meaning": r"$\mathrm{Ag|AgCl(s)|Cl^-}$; $E=E^\circ-0.0591\log[\mathrm{Cl^-}]$.", "topic": "T3"},
    {"term": "Sparingly soluble salt", "meaning": r"AgCl, $\mathrm{Hg_2Cl_2}$: the salt layer on the metal.", "topic": "T3"},
    {"term": "Standard hydrogen electrode", "meaning": r"1 atm $\mathrm{H_2}$, 1 M $\mathrm{H^+}$; $E^\circ=0$.", "topic": "T4"},
    {"term": "Stannic–stannous electrode", "meaning": r"$\mathrm{Pt|Sn^{4+},Sn^{2+}}$.", "topic": "T6"},
]

RAPID = [
    {"q": "How many electrodes make a cell?", "a": "Two (two half-cells)."},
    {"q": "Six types of electrodes?", "a": "Metal–metal ion, metal–insoluble salt–anion, gas, amalgam, redox, ion-selective."},
    {"q": "In what form is an electrode reaction written?", "a": "As a reduction."},
    {"q": "Ag/AgCl reaction?", "a": r"$\mathrm{AgCl+e^-\rightleftharpoons Ag+Cl^-}$."},
    {"q": "Ag/AgCl Nernst equation?", "a": r"$E=E^\circ-0.0591\log[\mathrm{Cl^-}]$."},
    {"q": "Example of a metal–insoluble salt electrode besides Ag/AgCl?", "a": r"Calomel, $\mathrm{Hg|Hg_2Cl_2|KCl}$."},
    {"q": "Role of Pt in a gas electrode?", "a": "Electrical contact; helps set up the gas–ion equilibrium."},
    {"q": "Hydrogen electrode Nernst equation?", "a": r"$E=E^\circ-\frac{0.0591}{2}\log\frac{p_{H_2}}{[\mathrm{H^+}]^2}$."},
    {"q": "SHE conditions?", "a": r"1 atm $\mathrm{H_2}$, 1 M $\mathrm{H^+}$, $E=0$."},
    {"q": r"$\mathrm{H_2}$ electrode at pH 3, 2 atm?", "a": "−0.1862 V."},
    {"q": "Why use an amalgam?", "a": "To lower and control the activity of a reactive metal (e.g. Na)."},
    {"q": "Lead amalgam representation?", "a": r"$\mathrm{Pb\!-\!Hg|Pb^{2+}}$."},
    {"q": "Redox electrode examples?", "a": r"$\mathrm{Pt|Fe^{3+},Fe^{2+}}$; $\mathrm{Pt|Ce^{4+},Ce^{3+}}$; $\mathrm{Pt|Sn^{4+},Sn^{2+}}$."},
    {"q": "Stannic–stannous Nernst equation?", "a": r"$E=E^\circ-\frac{0.0591}{2}\log\frac{[\mathrm{Sn^{2+}}]}{[\mathrm{Sn^{4+}}]}$."},
    {"q": "Quinhydrone standard potential?", "a": "+0.699 V."},
    {"q": "Quinhydrone potential at pH 4?", "a": "0.4626 V."},
    {"q": "What is an ion-selective electrode?", "a": "A membrane electrode whose membrane exchanges one ion, so its potential depends on that ion."},
    {"q": "Glass electrode equation?", "a": r"$E_G=E^\circ_G+0.0591\log[\mathrm{H^+}]=E^\circ_G-0.0591\,\mathrm{pH}$."},
    {"q": "Glass + SCE cell (PESU form)?", "a": r"$\mathrm{Hg|Hg_2Cl_2|KCl(sat)\,||}$<br>$\mathrm{H^+|glass|0.1\,M\,HCl|AgCl|Ag}$."},
    {"q": "Ag/AgCl at 0.1 M chloride?", "a": "0.2811 V (with E° = 0.222 V)."},
]

MNEMONICS = [
    "<i>“Metal reacts, Pt watches, membrane swaps.”</i> The three groups: metal–ion, amalgam and insoluble-salt electrodes; gas and redox electrodes on inert Pt; ion-selective membranes (a study aid).",
]

TOP_FACTS = [
    "Six types: metal–metal ion, metal–insoluble salt–anion, gas, amalgam, redox (quinhydrone), ion-selective.",
    r"Always write the reduction; $E=E^\circ-\frac{0.0591}{n}\log\frac{\text{products}}{\text{reactants}}$; solids = 1, gases as $p$.",
    r"$\mathrm{Ag/AgCl}$: $\mathrm{AgCl+e^-\rightleftharpoons Ag+Cl^-}$ (Ag, not $\mathrm{Ag^+}$); $E=E^\circ-0.0591\log[\mathrm{Cl^-}]$.",
    r"Gas: Pt + gas + its ions; $E=E^\circ-\frac{0.0591}{2}\log\frac{p_{H_2}}{[\mathrm{H^+}]^2}$; SHE = 0 V.",
    r"Amalgam keeps $[\mathrm{Pb\text{-}Hg}]$ in the log term; amalgamation tames reactive Na.",
    r"Redox: Pt in both forms; $E=E^\circ-\frac{0.0591}{2}\log\frac{[\mathrm{Sn^{2+}}]}{[\mathrm{Sn^{4+}}]}$.",
    r"Quinhydrone: $E^\circ=0.699$ V; $E=0.699-0.0591\,\mathrm{pH}$ (below pH 8).",
    r"ISE: membrane exchanges one ion. Glass: $E_G=E^\circ_G-0.0591\,\mathrm{pH}$.",
    r"Glass + SCE: $\mathrm{Hg|Hg_2Cl_2|KCl(sat)||H^+|glass|0.1\,M\,HCl|AgCl|Ag}$; $E_{cell}=E_G-E_{SCE}$.",
    "ESA: notes on redox + gas electrodes (Dec 2023); ISE + glass|SCE cell (Jun 2024, Jan 2025).",
]
TOP_FORMULAS = ["E1.1", "E3.1", "E4.1", "E6.1", "E6.3", "E7.1"]
