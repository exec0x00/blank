import numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.rcParams.update({"svg.fonttype":"none","font.size":9,"font.family":"sans-serif","axes.spines.top":False,"axes.spines.right":False})
O="/home/user/blank/output/assets/figures/"
def save(n): plt.savefig(O+n+".svg",format="svg",bbox_inches="tight"); plt.close()
BL,GR,VI="#1f5fa8","#2e7d4f","#7a4fb3"
# G9 rotational levels
fig,ax=plt.subplots(figsize=(4.2,3.4))
for J in range(7):
    e=J*(J+1); ax.hlines(e,0,1,color=BL,lw=1.5); ax.text(1.03,e,f"J={J}   {e}B",va="center")
    if J<6: ax.annotate("",xy=(0.3+0.07*J,(J+1)*(J+2)),xytext=(0.3+0.07*J,e),arrowprops=dict(arrowstyle="->",color="k"))
ax.set_xlim(0,1.5);ax.set_xticks([]);ax.set_ylabel("ε_J (cm⁻¹)");ax.set_title("Rigid-rotor levels, ΔJ = +1")
save("G9")
# G10 spectrum
fig,ax=plt.subplots(figsize=(4.6,2.4)); J=np.arange(0,10); I=(2*J+1)*np.exp(-J*(J+1)/25)
ax.vlines(2*(J+1),0,I/I.max(),color=BL,lw=1.8)
ax.set_xticks(2*(J+1)); ax.set_xticklabels([f"{2*(j+1)}B" for j in J],fontsize=7); ax.set_yticks([]); ax.set_xlabel("wavenumber (cm⁻¹)")
ax.set_title("Rotational spectrum: lines at 2B, 4B, 6B… spacing 2B"); save("G10")
# G13 SHO and G15/16 Morse
r=np.linspace(-1.6,1.6,200); fig,ax=plt.subplots(figsize=(3.8,3.4)); ax.plot(r,r**2,color=BL)
for v in range(6):
    e=v+.5; x=np.sqrt(e); ax.hlines(e,-x,x,color="k",lw=.8); ax.text(1.65,e,f"v={v}",va="center",fontsize=7)
ax.set_xlim(-1.7,2.1);ax.set_xticks([]);ax.set_yticks([]);ax.set_xlabel("r − r_eq");ax.set_ylabel("energy");ax.set_title("SHO: parabola, equal spacing ν̄_osc; ε₀=½ν̄_osc");save("G13")
fig,ax=plt.subplots(figsize=(4.2,3.6)); r=np.linspace(-.6,4,300); a=1.2; V=(1-np.exp(-a*r))**2
ax.plot(r,V,color=VI,label="Morse (anharmonic)"); ax.plot(r,(a*r)**2,"--",color=BL,label="harmonic"); ax.set_ylim(0,1.6); ax.axhline(1,color="gray",ls=":"); ax.text(3.0,1.04,"D_eq / dissociation limit",fontsize=7)
for v in range(8):
    e=(v+.5)*.2-(v+.5)**2*.0125
    if e<1:
        m=r[V<=e]; ax.hlines(e,m.min(),m.max(),lw=.8,color="k")
ax.annotate("",xy=(0.7,.3),xytext=(0.7,.1)) 
ax.legend(fontsize=7,loc="upper right",bbox_to_anchor=(1,.85));ax.set_xticks([]);ax.set_yticks([]);ax.set_xlabel("r");ax.set_ylabel("PE");ax.set_title("Morse vs harmonic: levels converge");save("G15")
# G17 anharmonic spectrum
we,xe=2000,.02; fig,ax=plt.subplots(figsize=(4.6,2.4))
pos={"hot (1→2)":we*(1-4*xe),"fundamental":we*(1-2*xe),"1st overtone":2*we*(1-3*xe),"2nd overtone":3*we*(1-4*xe)}
for (k,x),h in zip(pos.items(),[.3,1,.35,.12]): ax.vlines(x,0,h,color=GR,lw=2); ax.text(x,h+.03,k,rotation=60,fontsize=7)
ax.set_ylim(0,1.5);ax.set_yticks([]);ax.set_xlabel("wavenumber (schematic)");ax.set_title("Anharmonic spectrum (schematic)");save("G17")
# G21 Franck-Condon 3 cases
fig,axs=plt.subplots(2,3,figsize=(7.2,4.4),gridspec_kw={"height_ratios":[2,1]})
r=np.linspace(.5,5,300)
for i,(shift,t) in enumerate([(0,"(a) r_e′ = r_e″"),(.8,"(b) r_e′ > r_e″"),(2.4,"(c) r_e′ ≫ r_e″")]):
    ax=axs[0,i]; ax.plot(r,(1-np.exp(-1.3*(r-1.5)))**2,color=BL); ax.plot(r,2+(1-np.exp(-1.3*(r-1.5-shift)))**2,color=VI)
    ax.annotate("",xy=(1.5,2+(1-np.exp(-1.3*(-shift)))**2),xytext=(1.5,.05),arrowprops=dict(arrowstyle="->",lw=1.6)); ax.set_title(t,fontsize=8);ax.set_xticks([]);ax.set_yticks([]);ax.set_ylim(0,4)
    ax=axs[1,i]
    if i==0: ax.vlines(range(5),0,[1,.5,.25,.12,.06],color=GR,lw=2)
    elif i==1: ax.vlines(range(5),0,[.2,.6,1,.7,.3],color=GR,lw=2)
    else: ax.fill_between(np.linspace(0,4,50),0,np.linspace(.2,1,50)**.5,color=GR,alpha=.5); ax.vlines(range(3),0,[.3,.4,.5],color=GR,lw=1.5)
    ax.set_yticks([]);ax.set_xticks([]);ax.set_xlabel("spectrum →",fontsize=7)
fig.suptitle("Franck–Condon: vertical transitions (schematic)",fontsize=9);save("G21")
# G22 water
fig,ax=plt.subplots(figsize=(4.6,3.6)); T=np.linspace(0.01,374,100); P=4.58*np.exp(T/48)/1; 
Pa=np.clip(4.58*np.exp((T)/52.),0,218*760); 
ax.plot([0.0098,374],[0,1],alpha=0)
# schematic coordinates
ax.plot([0,374],[0.15,0.15],alpha=0)
O_=(0.0098,0.12); A=(374,1.0)
tt=np.linspace(O_[0],A[0],100); ax.plot(tt,0.12+0.88*((tt/374)**2.2),color=BL,label="OA vaporisation")
tb=np.linspace(-60,O_[0],50); ax.plot(tb,0.12*np.exp((tb)/45),color=GR,label="OB sublimation")
ax.plot([0.0098,-12],[0.12,1.0],color=VI,label="OC melting (negative slope)")
ta=np.linspace(-25,0.0098,30); ax.plot(ta,0.12*np.exp(ta/60)*1.12,"--",color="k",label="OA′ metastable")
for x,y,s in [(60,.08,"vapour F=2"),(-45,.7,"ice F=2"),(170,.55,"water F=2")]: ax.text(x,y,s,fontsize=7)
ax.text(8,0.04,"O triple pt\n0.0098 °C, 4.58 mmHg  F=0",fontsize=6.5); ax.text(270,1.02,"A critical 374 °C, 218 atm F=0",fontsize=6.5,ha="right")
ax.set_xlabel("temperature (°C)");ax.set_ylabel("pressure");ax.set_yticks([]);ax.set_ylim(0,1.12);ax.legend(fontsize=6.5,loc="center left");ax.set_title("Water phase diagram (schematic, not to scale)");save("G22")
# G23 Pb-Ag
fig,ax=plt.subplots(figsize=(4.6,3.4)); x=np.linspace(0,2.6,20); xe=2.6; x2=np.linspace(2.6,100,50)
ax.plot([0,2.6],[327,303],color=BL); ax.plot([2.6,100],[303,961],color=GR); ax.hlines(303,0,100,color="k",lw=1)
ax.text(1,200,"solid Pb + solid Ag",fontsize=8); ax.text(20,500,"liquid + solid Ag",fontsize=7,rotation=0); ax.text(1,330,"L+Pb",fontsize=6.5); ax.text(60,850,"liquid melt",fontsize=8)
ax.text(5,280,"O eutectic: 303 °C, 2.6 % Ag",fontsize=7)
ax.set_xlabel("composition (wt % Ag) Pb → Ag");ax.set_ylabel("temperature (°C)");ax.set_title("Pb–Ag eutectic (schematic; Pb left, Ag right)");save("G23")
# G24 cooling curves
fig,axs=plt.subplots(1,3,figsize=(7,2.6),sharey=True)
t=np.linspace(0,10,100)
axs[0].plot(t,np.piecewise(t,[t<3,(t>=3)&(t<6),t>=6],[lambda t:10-1.5*t,5.5,lambda t:5.5-(t-6)*.9])[::-1][::-1],color=BL);axs[0].set_title("pure substance: halt",fontsize=8)
axs[1].plot(t,np.piecewise(t,[t<3,(t>=3)&(t<6),t>=6],[lambda t:10-1.5*t,lambda t:5.5-.5*(t-3),lambda t:4-(t-6)*.7]),color=GR);axs[1].set_title("mixture: slope break",fontsize=8)
axs[2].plot(t,np.piecewise(t,[t<3,(t>=3)&(t<6),t>=6],[lambda t:10-1.5*t,3.5,lambda t:3.5-(t-6)*.7]),color=VI);axs[2].set_title("eutectic: single halt",fontsize=8)
for a in axs: a.set_xlabel("time");a.set_xticks([]);a.set_yticks([])
axs[0].set_ylabel("temperature");save("G24")
# G8 / G25 ethane
th=np.linspace(0,360,200); fig,ax=plt.subplots(figsize=(4,2.4)); ax.plot(th,1.5*(1-np.cos(np.radians(3*th))),color=BL); ax.set_xlabel("dihedral angle (°)");ax.set_ylabel("E (kcal/mol)");ax.set_title("Ethane torsion barrier ≈ 3.0 kcal/mol");ax.set_xticks([0,60,120,180,240,300,360]);save("G25")
print("ok")
