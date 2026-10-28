# Edge-thickness check for SYNOPSYS RLE files (meridional real-ray trace, d-line GLM nd).
# usage: python rle_edge_check.py [file.RLE ...] [--detail]   (default: DSEARCH01-10.RLE in the current folder)
# Meridional real-ray trace of a SYNOPSYS RLE (spheres/conics, d-line GLM nd) to compare
# beam footprints with and without VFIELD, and edge thickness at those heights.
#
# rle_edge_check.py, part of the DSEARCH macro builder
# Copyright (C) 2026 anvcor
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import sys, re, math
def load(p):
    S={}; vf=[]; obb=None; lines=open(p,encoding='latin1').read().splitlines()
    for i,l in enumerate(lines):
        t=l.split()
        if not t: continue
        if t[0]=='VFIELD':
            n=int(t[1]); vf=[list(map(float,lines[i+1+k].split())) for k in range(n)]
        if t[0]=='OBB': obb=list(map(float,t[1:]))
        if re.match(r'^\d+$',t[0]):
            s=int(t[0]); d=S.setdefault(s,{'c':0.0,'th':0.0,'n':1.0,'k':0.0,'a':[0]*5})
            if 'RAD' in t: d['c']=1/float(t[t.index('RAD')+1])
            if t[1]=='CV': d['c']=float(t[2])
            if 'TH' in t: d['th']=float(t[t.index('TH')+1])
            if t[1]=='GLM': d['n']=float(t[2])
            if t[1]=='CC': d['k']=float(t[2])
            if t[1]=='DC1': d['a']=[float(x) for x in t[2:7]]
    return S,vf,obb
def sag(d,h):
    c,k=d['c'],d['k']; r2=h*h; arg=1-(1+k)*c*c*r2
    if arg<0: return float('nan')
    z=c*r2/(1+math.sqrt(arg))
    a=d['a']; return z+a[1]*h**4+a[2]*h**6+a[3]*h**8+a[4]*h**10
def trace(S,y0,m):
    # start at s1 vertex plane z=0, direction (1,m) normalized; returns heights at surfaces
    ns=sorted(k for k in S if k>0); z0=0.0; y=y0; L=1/math.sqrt(1+m*m); M=m*L; n1=1.0; hs={}
    zv=0.0
    for s in ns:
        d=S[s]
        if s==ns[-1]: hs[s]=y+M/L*(zv-z0); break
        # Newton on f(t)= z(t)-zv - sag(y(t))
        t=(zv-z0)/L
        for _ in range(40):
            zz=z0+t*L; yy=y+t*M; f=zz-zv-sag(d,yy)
            e=1e-6; df=(zz+e*L-zv-sag(d,yy+e*M)-f)/e
            dt=-f/df; t+=dt
            if abs(dt)<1e-12: break
        zz=z0+t*L; yy=y+t*M; hs[s]=yy
        if math.isnan(zz): return None
        # normal
        e=1e-6; dz=(sag(d,yy+e)-sag(d,yy-e))/(2*e); nz,ny=1/math.sqrt(1+dz*dz),-dz/math.sqrt(1+dz*dz)
        n2=d['n'] if d['n']>1.0001 else 1.0
        if s>1 and S[s-1]['n']>1.0001 and d['n']<=1.0001: n2=1.0
        cosi=L*nz+M*ny; mu=n1/n2; k2=1-mu*mu*(1-cosi*cosi)
        if k2<0: return None
        g=math.sqrt(k2)-mu*cosi
        L,M=mu*L+g*nz,mu*M+g*ny; n1=n2
        z0,y=zz,yy; zv+=d['th']
    return hs
def vfat(vf,h):
    prev=[0,1,1,1]
    for r in vf:
        if h==r[0]: return r[1:]
        if r[0]>h: t=(h-prev[0])/(r[0]-prev[0]); return [prev[j]+(r[j]-prev[j])*t for j in (1,2,3)]
        prev=r
    return vf[-1][1:]

def analyse(path, tar=1.0, verbose=False):
    global S,vf,obb
    S,vf,obb=load(path)
    if not vf: vf=[[0,1,1,1]]
    U=obb[1]; Ry=obb[2]; YP1=obb[3]; tU=math.tan(math.radians(U))
    for s in S: S[s]['g']=S[s]['n']>1.0001
    for s in S:
        if not S[s]['g']: S[s]['n']=1.0
    fields=[0,.3,.5,.7,.85,1.0]
    def foot(mode):
        mx={}
        for h in (fields if mode!='aec' else [1.0]):
            a,b,x=vfat(vf,h) if mode!='full' else (1,1,1)
            for p in (+a,-b):
                hs=trace(S,h*YP1+p*Ry,h*tU)
                if hs is None: continue
                for s,v in hs.items(): mx[s]=max(mx.get(s,0),abs(v))
        return mx
    F={m:foot(m) for m in ('aec','vign','full')}
    last=max(S)
    rows=[]
    for s in sorted(S):
        if s+1 in S and 1<=s<last-1 or (S[s]['g'] and s+1 in S):
            r={'pair':'%d-%d'%(s,s+1),'kind':'glass' if S[s]['g'] else 'air'}
            for m in F:
                h=max(F[m].get(s,0),F[m].get(s+1,0)); r[m]=(h,S[s]['th']+sag(S[s+1],h)-sag(S[s],h))
            rows.append(r)
    return rows,F
if __name__=='__main__':
    import glob, os
    args=[a for a in sys.argv[1:] if not a.startswith('--')] or sorted(glob.glob('DSEARCH[0-9][0-9].RLE'))
    tar=float(next((a.split('=')[1] for a in sys.argv if a.startswith('--min=')),1.0))
    print('min edge thickness (mm) at: AEC rays (full-field rims after VFIELD) | vignetted beam, all fields | full beam (soft CAO, PAD drawing)')
    for p in args:
        rows,F=analyse(p,tar)
        merit=next((l.split()[1] for l in open(p,encoding='latin1') if l.split()[:1]==['MERIT']),'?')
        worst={m:min(rows,key=lambda r:r[m][1]) for m in ('aec','vign','full')}
        print('%-14s merit %-12s AEC %6.2f (%s) | vign %6.2f (%s) | full %6.2f (%s)'%(os.path.basename(p),merit,
              *[x for m in ('aec','vign','full') for x in (worst[m][m][1],worst[m]['pair'])]))
        if '--detail' in sys.argv:
            for r in rows: print('   %-6s %-5s  AEC h=%5.2f ET=%6.2f | vign h=%5.2f ET=%6.2f | full h=%5.2f ET=%6.2f'%(r['pair'],r['kind'],*r['aec'],*r['vign'],*r['full']))
