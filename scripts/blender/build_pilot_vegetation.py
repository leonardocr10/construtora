"""Assets exclusivos da cena-piloto (sem substituir a biblioteca existente).

blender -b --factory-startup --python build_pilot_vegetation.py -- apps/viewer/public/library
Modelos artisticos, nao identificacao botanica; dois LODs e folhas com recorte alpha.
"""
import json
import math
import os
import sys
sys.dont_write_bytecode = True
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_library import (reset, material, image_from_array, bark_image, draw_leaf_atlas,
                           tube, cards, ellipsoid_points, empty, export, triangles, srgb, mesh_object)


def foliage(name, palette, seed, size=512):
    atlas = draw_leaf_atlas(size, seed, [srgb(c) for c in palette], .14, .43, 95)
    return material('VH_Leaf_Pilot_'+name, rough=.86,
                    image=image_from_array(name+'_atlas', atlas), alpha_image=True, double=True)


def tree(out, upright=False):
    reset()
    name = 'pilot_tree_vertical' if upright else 'pilot_tree_canopy'
    rng = np.random.default_rng(982 if upright else 617)
    leaf = foliage(name, [(48,79,35),(73,104,44),(93,123,53),(112,136,68)] if not upright else
                   [(57,87,47),(79,108,58),(105,131,73),(128,143,89)], 89 if upright else 67)
    bark = material('VH_PilotBark', rough=.95, image=image_from_array('pilot_bark', bark_image(91)))
    # Copa composta por grupos separados, com vazios e ramos visiveis; sem bola opaca no LOD0.
    for lod in (0, 1):
        root = empty(name+'_lod'+str(lod)); root['vh_lod'] = lod
        tube(name+'_trunk',[(0,0,0),(.05,-.03,1.3),(-.06,.04,2.5),(.12,0,3.5)],
             [.19,.15,.105,.055],8 if not lod else 5,bark,root)
        centers=[];sizes=[];normals=[]
        branches = 9 if upright else 11
        for k in range(branches):
            a = k*2.399963+float(rng.uniform(-.17,.17))
            z = (3.2+k*.25 if upright else 3.45+(k%3)*.55)+float(rng.uniform(-.2,.2))
            reach = (1.05 if upright else 2.1)*float(rng.uniform(.7,1.18))
            c = (math.cos(a)*reach,math.sin(a)*reach,z+.65)
            tube(name+'_branch'+str(k),[(.04,0,2.35+(k%3)*.3),
                  (c[0]*.55,c[1]*.55,z-.12),c],[.065,.035,.009],5 if not lod else 4,bark,root)
            radii=(.95,.85,1.05) if upright else (1.28,1.1,.84)
            pts,nrm=ellipsoid_points(rng,29 if not lod else 13,*radii,c)
            centers.extend(pts);normals.extend(nrm)
            sizes.extend(rng.uniform(.7,1.05,len(pts))*(1.32 if lod else 1))
        pts,nrm=ellipsoid_points(rng,35 if not lod else 17,1.0,1.0,.8,(0,0,5.6 if upright else 4.8))
        centers.extend(pts);normals.extend(nrm);sizes.extend([1.05 if not lod else 1.3]*len(pts))
        cards(name+'_leaves',centers,sizes,normals,leaf,root,rng,cross=lod==0)
    path=os.path.join(out,'models',name+'.glb');export(path)
    return name,{'file':'models/'+name+'.glb','bytes':os.path.getsize(path),'triangles':triangles(),
                 'height':7.0 if upright else 6.3,'crown':4.0 if upright else 6.5}


def shrub(out, silver=False):
    reset();name='pilot_shrub_silver' if silver else 'pilot_groundcover'
    rng=np.random.default_rng(140 if silver else 151)
    leaf=foliage(name,[(104,126,101),(128,147,118),(150,160,125)] if silver else
                 [(38,74,36),(57,96,45),(85,116,54)],140 if silver else 151,256)
    for lod in (0,1):
        root=empty(name+'_lod'+str(lod));root['vh_lod']=lod
        for k in range(3):
            a=k*2.4;c=(math.cos(a)*.22,math.sin(a)*.19,.37 if silver else .16)
            pts,nrm=ellipsoid_points(rng,24 if not lod else 10,.43,.4,.32 if silver else .12,c)
            cards(name+'_leaves'+str(k),pts,rng.uniform(.32,.51,len(pts))*(1.3 if lod else 1),nrm,leaf,root,rng,cross=lod==0)
    path=os.path.join(out,'models',name+'.glb');export(path)
    return name,{'file':'models/'+name+'.glb','bytes':os.path.getsize(path),'triangles':triangles(),
                 'height':.9 if silver else .35,'crown':1.4}


def tuft(out):
    reset();name='pilot_grass_tuft';rng=np.random.default_rng(178)
    mats=[material('VH_Leaf_PilotGrass'+str(i),color=tuple(c**2.2),rough=.92,double=True)
          for i,c in enumerate([srgb((91,112,52)),srgb((117,132,67)),srgb((71,97,44))])]
    for lod,n in ((0,58),(1,24)):
        root=empty(name+'_lod'+str(lod));root['vh_lod']=lod
        verts=[];faces=[];indices=[];uvs=[]
        for i in range(n):
            a=float(rng.uniform(0,math.tau));h=float(rng.uniform(.33,.65));reach=float(rng.uniform(.18,.48))
            base=np.array([math.cos(a)*.06,math.sin(a)*.06,0]);side=np.array([-math.sin(a),math.cos(a),0])
            points=[base+np.array([math.cos(a)*reach*t*t,math.sin(a)*reach*t*t,h*(t-.22*t*t)]) for t in (0,.33,.67,1)]
            for j in range(3):
                width=.025*(1-j/3)*(.8 if lod==0 else 1.4);b=len(verts)
                verts.extend([tuple(points[j]-side*width),tuple(points[j]+side*width),tuple(points[j+1]+side*width*.5),tuple(points[j+1]-side*width*.5)])
                faces.append((b,b+1,b+2,b+3));indices.append(i%3);uvs.append([(0,0),(1,0),(1,1),(0,1)])
        mesh_object(name+'_blades',verts,faces,mats,face_mats=indices,uvs=uvs,parent=root)
    path=os.path.join(out,'models',name+'.glb');export(path)
    return name,{'file':'models/'+name+'.glb','bytes':os.path.getsize(path),'triangles':triangles(),'height':.65,'crown':1.0}


def main():
    args=sys.argv[sys.argv.index('--')+1:];out=os.path.abspath(args[0])
    os.makedirs(os.path.join(out,'models'),exist_ok=True)
    entries=dict([tree(out),tree(out,True),shrub(out,True),shrub(out),tuft(out)])
    path=os.path.join(out,'library.json')
    with open(path,encoding='utf8') as f:catalog=json.load(f)
    catalog.setdefault('models',{}).update(entries)
    catalog['pilotVegetation']={'version':1,'generator':'scripts/blender/build_pilot_vegetation.py',
                                'license':'Assets procedurais proprios; uso comercial permitido no projeto.'}
    with open(path,'w',encoding='utf8') as f:json.dump(catalog,f,ensure_ascii=False,indent=2)
    print('VH_PILOT '+json.dumps(entries))


if __name__=='__main__':main()
