"""Load check of the ELGT twin-X Y beams (BR-ELGT-BS-<X>-ELGT-BS-<Y>-2), 2026-10-24: section, deflection, torsion,
frequencies and L_max per X / Y pair, bolt loads (reports/brackets/2026-10-24-2340-BR-ELGT-BS-twin-X-Y.md).

    python calc_elgt_twin_ybeam.py
"""

import math
E=70000.; G=26300.; rho=2.70e-6; g=9.81
def sec(H,B,t):
    A=B*H-(B-2*t)*(H-2*t)
    Ih=(B*H**3-(B-2*t)*(H-2*t)**3)/12
    Ib=(H*B**3-(H-2*t)*(B-2*t)**3)/12
    Am=(B-t)*(H-t); J=4*Am**2*t/(2*((B-t)+(H-t)))
    return dict(A=A,Ih=Ih,Ib=Ib,J=J,H=H,B=B,t=t,Am=Am)
# case: name, section, inner bolt row from each end, zc (Y centreline above beam bottom), M stage, m_payloadY (on Y slide), a_lat(Z react on Y payload), front COG from beam front face, vertical COG rel Y centreline (stage z)
ax=5.0; ay=5.0
cases=[
 # name, (H,B,t), s_in, zc, M, mY_payload, a_react, d_front, z_stage, Ymoving
 ('X90/Y90',  (160,80,8), 281.5, 57.5, 16.45, 5.0, 0.0, None, -15.2, 6.645),
 ('X120/Y90', (160,80,8), 281.5, 72.5, 16.45, 5.0, 0.0, None, -15.2, 6.645),
 ('X120/Y120',(160,80,8), 281.5, 72.5, 28.77, 15.44, 2.15, None, -70.1, 17.47),
 ('X160/Y120',(200,80,10),284.5, 92.5, 31.77, 18.44, 2.61, None, -90.2, 20.47),
 ('X160/Y160',(200,80,10),284.5, 92.5, 53.19, 26.47, 2.65, None, -89.4, 30.31),
]
# front COG: components (mass, distance from the Y profile underside)
def front(name, M, mp, yaxis_mass, slide, drive, d_load, surf, spindle):
    prof=yaxis_mass-slide
    pts=[(prof,surf*0.45),(drive,spindle),(slide,surf-15),(mp,surf+d_load)]
    return sum(m*d for m,d in pts)/sum(m for m,_ in pts)
fr={'X90/Y90':front('',0,5,9.453,1.645,2,50,90,57.5),
    'X120/Y90':front('',0,5,9.453,1.645,2,50,90,57.5),
    'X120/Y120':front('',0,15.44,11.335,2.036,2,83.5,90,44),
    'X160/Y120':front('',0,18.44,11.335,2.036,2,94.7,90,44),
    'X160/Y160':front('',0,26.47,24.721,3.842,2,97.7,100,50)}
def check(c, L, sect=None, verbose=False):
    name,(H,B,t),sin,zc,M,mp,alat,_,zs,mov=c
    if sect: H,B,t=sect
    s=sec(H,B,t)
    Ls=L-2*sin
    w=rho*s['A']  # kg/mm
    mb=w*L
    Fv=M*g+mp*alat
    Fh=M*ax
    wv=w*g; wh=w*ax  # N/mm
    dv=Fv*Ls**3/(48*E*s['Ih'])+5*wv*Ls**4/(384*E*s['Ih'])
    dh=Fh*Ls**3/(48*E*s['Ib'])+5*wh*Ls**4/(384*E*s['Ib'])
    ef=B/2+fr[name]; ev=zc+zs-H/2
    T=(Fv*ef+Fh*abs(ev))  # N mm
    th=(T/2)*(Ls/2)/(G*s['J'])
    r=math.hypot(ef,ev)
    kh=48*E*s['Ib']/Ls**3*1000; kv=48*E*s['Ih']/Ls**3*1000
    fh=math.sqrt(kh/(M+0.486*w*Ls))/2/math.pi
    fv=math.sqrt(kv/(M+0.486*w*Ls))/2/math.pi
    kt=4*G*s['J']/Ls*1e-3  # Nm/rad (N mm/rad /1000)
    It=M*(r/1000)**2 + (w*Ls)*((B**2+H**2)/12)/1e6/3
    ft=math.sqrt(kt/It)/2/math.pi
    Mb=math.hypot(Fv*Ls/4+wv*Ls**2/8, Fh*Ls/4+wh*Ls**2/8)
    W=min(2*s['Ih']/H,2*s['Ib']/B)
    sig=Mb/W; tau=(T/2)/(2*s['Am']*t)
    vm=math.sqrt(sig**2+3*tau**2)
    return dict(L=L,Ls=Ls,mb=mb,Fv=Fv,Fh=Fh,T=T/1000,dv=dv,dh=dh,th=th*1000,dcog=th*r,fh=fh,fv=fv,ft=ft,vm=vm,ef=ef,ev=ev,kgm=w*1e6)
def lmax(c, sect=None):
    L=700
    while True:
        r=check(c,L+10,sect)
        if r['dh']>0.05 or r['dv']>0.05 or r['fh']<50 or r['fv']<50 or r['ft']<50 or r['dcog']>0.05: return L, check(c,L,sect)
        L+=10
for c in cases:
    Lm,r=lmax(c)
    print(c[0], 'front COG', round(fr[c[0]],1), 'Lmax', Lm, {k:round(v,3) for k,v in r.items()})
    for L in (1000,1500):
        r=check(c,L); print('   L',L,{k:round(v,3) for k,v in r.items() if k in('dv','dh','th','dcog','fh','fv','ft','vm','mb','T')})
for sect in [(160,100,8),(200,100,10),(200,120,10),(250,100,10)]:
    for c in cases:
        print(sect, c[0], lmax(c,sect)[0])
print('--- bolts at Lmax')
rowsK={'X90/Y90':36,'X120/Y90':50,'X120/Y120':50,'X160/Y120':67,'X160/Y160':67}
rowsY={'X90/Y90':36,'X120/Y90':36,'X120/Y120':50,'X160/Y120':50,'X160/Y160':67}
pre={'X90/Y90':(6700,'M6'),'X120/Y90':(6700,'M6'),'X120/Y120':(6700,'M6'),'X160/Y120':(11300,'M8'),'X160/Y160':(11300,'M8')}
preY={'X90/Y90':6700,'X120/Y90':6700,'X120/Y120':6700,'X160/Y120':6700,'X160/Y160':11300}
for c in cases:
    name=c[0]; Lm,r=lmax(c); s=sec(*c[1]); w=rho*s['A']
    Ls=r['Ls']; Fh=r['Fh']; Fv=r['Fv']; T=r['T']*1000
    mov=c[9]; Fy=(mov)*ay
    Mh=Fh*Ls/8+w*ax*Ls**2/12
    tK=Fh/2/6 + T/2/(2*rowsK[name])/3 + Mh/200/2
    vK=math.hypot((Fv+w*g*Lm)/2, Fy/2)/6
    slipK=0.12*(pre[name][0]-tK)/vK
    df=fr[name]; zs=c[8]
    Mx=Fv*df+Fh*abs(zs)
    tY=Mx/(2*rowsY[name])/3 + Fh/6 + Fy*df/200/2
    vY=math.hypot(Fv,Fy)/6
    slipY=0.12*(preY[name]-tY)/vY
    print(name,'Lmax',Lm,'kit bolt tension %.0f N shear %.0f N slipSF %.1f | Y bolt tension %.0f shear %.0f slipSF %.1f, Fy %.0f'%(tK,vK,slipK,tY,vY,slipY,Fy))
