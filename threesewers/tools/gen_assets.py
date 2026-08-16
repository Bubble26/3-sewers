#!/usr/bin/env python3
"""THREE SEWERS — project asset generator (vertical slice roster)."""
import math, os
from PIL import Image, ImageDraw, ImageFont

P = "threesewers/assets"
for d in ("characters","props","icon"): os.makedirs(f"{P}/{d}", exist_ok=True)

PAPER=(239,227,200); INK=(43,31,23); BROWNSTONE=(110,74,50); BRICK=(156,74,50)
ASPHALT=(85,80,74); CHALK=(255,247,228); PINK=(228,98,111); PATINA=(94,130,114)
GOLD=(217,164,65); CLEAR=(0,0,0,0)

def font(sz):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, sz)
            except Exception: pass
    return ImageFont.load_default()
F10=font(10);F14=font(14);F18=font(18);F24=font(24);F34=font(34)
def ct(d,xy,s,f,fill): d.text(xy,s,font=f,fill=fill,anchor="mm")

# id: (display, archetype, body, color, PWR,CON,SPD,ARM,GLV, quirk)
KIDS={
 "mabel":   ("Mabel Boone","Quiet girl, Sunday dress","M",(228,98,111),10,8,5,5,5,"Three Sewers"),
 "ezra":    ("Ezra Feldman","Newsboy, coin apron","S",(140,180,196),3,6,10,4,6,"Extra! Extra!"),
 "patsy":   ("Patsy Doyle","Bootblack","S",(196,148,180),4,6,6,5,10,"Spit Shine"),
 "sadie":   ("Sadie Rabinowitz","Deli owner's kid","S",(200,170,110),5,8,5,5,6,"On the House"),
 "nellie":  ("Nellie O'Rourke","Tomboy, skinned knee","M",(94,130,114),5,7,8,6,8,"Headfirst"),
 "sal":     ("Sal Marchetti","Ace, taped broomstick","M",(120,110,160),4,5,5,9,6,"Spinner"),
 "gus":     ("Gus Papadakis","Candy-store catcher","L",(178,124,84),6,4,3,9,7,"Rifle"),
 "vito":    ("Vito Bonetti","Iceman's kid","L",(156,74,50),10,4,2,5,4,"Wallop"),
 "pearl":   ("Pearl Chen","Laundry line lookout","S",(120,168,140),4,10,6,4,6,"Eagle Eye"),
 "tommy":   ("Tommy Wong","Southpaw","M",(100,140,170),5,6,7,8,8,"Southpaw"),
 "corny":   ("Corny Vanderberg III","Rich kid, boughten bat","M",(180,160,60),7,5,3,5,4,"Boughten Bat"),
 "whistles":("Whistles McGee","The lookout","S",(190,190,170),2,5,9,3,8,"Lookout"),
}
ANIMS={"idle":4,"bat_stance":2,"swing":6,"run":8,"pitch":8,"throw":4,"catch":3,"slide":4,"celebrate":4,"sulk":2}
BODY={"S":(20,34,44),"M":(24,42,56),"L":(24,58,52)}

def draw_kid(d,cx,base_y,body,col,ang=None,step=None,dress=False):
    hr,bw,bh=BODY[body]; leg=22
    top=base_y-leg-bh; hcy=top-hr+6
    d.rounded_rectangle([cx-bw//2+4,base_y-leg,cx-4,base_y],4,fill=col,outline=INK,width=2)
    d.rounded_rectangle([cx+4,base_y-leg,cx+bw//2-4,base_y],4,fill=col,outline=INK,width=2)
    if dress:
        d.polygon([(cx-bw//2,top),(cx+bw//2,top),(cx+bw//2+10,base_y-leg+6),(cx-bw//2-10,base_y-leg+6)],fill=col,outline=INK)
    else:
        d.rounded_rectangle([cx-bw//2,top,cx+bw//2,base_y-leg+4],12,fill=col,outline=INK,width=3)
    d.ellipse([cx-hr,hcy-hr,cx+hr,hcy+hr],fill=col,outline=INK,width=3)
    if dress:
        d.arc([cx-hr-4,hcy-hr-6,cx+hr+4,hcy+hr],200,340,fill=INK,width=5)  # bonnet brim
    else:
        d.polygon([(cx-hr,hcy-4),(cx+hr,hcy-4),(cx+hr+8,hcy-10),(cx-hr,hcy-10)],fill=INK)
    if ang is not None:
        a=math.radians(ang); x2,y2=cx+58*math.cos(a),top+10-58*math.sin(a)
        d.line([cx+bw//2-4,top+12,x2,y2],fill=BROWNSTONE,width=6)

for kid,(disp,arch,body,col,*rest) in KIDS.items():
    quirk=rest[5]
    for anim,total in ANIMS.items():
        for f in range(total):
            im=Image.new("RGBA",(128,160),CLEAR); d=ImageDraw.Draw(im)
            bob=int(4*math.sin(2*math.pi*f/max(total,1)))
            ang=None;step=None
            if anim=="swing": ang=-60+(180*f/(total-1))
            if anim=="pitch": ang=200-(160*f/(total-1))
            if anim=="run": step=f
            draw_kid(d,64,150+(bob if anim in("idle","celebrate","sulk","bat_stance") else 0),
                     body,col,ang,step,dress=(kid=="mabel"))
            d.line([60,156,68,156],fill=PINK,width=3)
            im.save(f"{P}/characters/chr_{kid}_{anim}_{f}.png")
    # card 600x840
    im=Image.new("RGBA",(600,840),(*CHALK,255)); d=ImageDraw.Draw(im)
    d.rectangle([10,10,590,830],outline=INK,width=8); d.rectangle([26,26,574,814],outline=INK,width=2)
    d.rectangle([26,26,574,86],fill=PATINA); ct(d,(300,56),"SANDLOT STARS",F24,CHALK)
    d.rectangle([56,110,544,470],fill=(*PAPER,255),outline=INK,width=3)
    d.ellipse([210,170,390,350],fill=col,outline=INK,width=6)
    if kid=="mabel": d.arc([200,150,400,360],200,340,fill=INK,width=10)
    else: d.polygon([(210,244),(390,244),(420,222),(210,222)],fill=INK)
    d.ellipse([500,130,540,170],fill=PINK,outline=INK,width=4)
    ct(d,(300,516),disp.upper(),F34,INK); ct(d,(300,566),arch,F18,ASPHALT)
    ct(d,(300,616),f'"{quirk.upper()}"',F18,BRICK)
    PWR,CON,SPD,ARM,GLV=rest[:5]
    ct(d,(300,672),f"PWR {PWR} · CON {CON} · SPD {SPD} · ARM {ARM} · GLV {GLV}",F18,INK)
    d.rectangle([26,790,574,814],fill=GOLD)
    im.save(f"{P}/characters/chr_{kid}_card.png")

# cop (CHEESE IT!) walk 4 + megaphone announcer idle 2
for f in range(4):
    im=Image.new("RGBA",(128,176),CLEAR); d=ImageDraw.Draw(im)
    draw_kid(d,64,166,"L",(60,74,110),None,f)
    d.ellipse([40,4,88,40],fill=(60,74,110),outline=INK,width=3)  # tall helmet
    d.rectangle([36,34,92,42],fill=INK)
    im.save(f"{P}/characters/npc_cop_walk_{f}.png")
for f in range(2):
    im=Image.new("RGBA",(128,160),CLEAR); d=ImageDraw.Draw(im)
    draw_kid(d,58,150,"S",(150,150,120))
    d.polygon([(78,58),(116,44+f*4),(116,76-f*4)],fill=GOLD,outline=INK)  # tin megaphone
    im.save(f"{P}/characters/npc_announcer_idle_{f}.png")

# props
def prop(name,size,painter):
    im=Image.new("RGBA",size,CLEAR); painter(ImageDraw.Draw(im),size)
    im.save(f"{P}/props/prp_{name}.png")
prop("spaldeen",(24,24),lambda d,s:(d.ellipse([2,2,22,22],fill=PINK,outline=INK,width=2),
     d.ellipse([6,6,11,11],fill=(255,214,220))))
prop("manhole",(140,64),lambda d,s:(d.ellipse([3,6,137,58],fill=(62,56,51),outline=INK,width=4),
     d.ellipse([26,18,114,46],outline=PATINA,width=3)))
prop("sewer",(120,52),lambda d,s:(d.ellipse([3,5,117,47],fill=(58,53,48),outline=INK,width=4),
     d.line([26,26,94,26],fill=(30,25,20),width=4)))
prop("hydrant",(64,96),lambda d,s:(d.rounded_rectangle([16,26,48,88],8,fill=BRICK,outline=INK,width=3),
     d.ellipse([12,10,52,32],fill=BRICK,outline=INK,width=3)))
prop("stoop",(150,110),lambda d,s:[d.rectangle([10+i*10,86-i*26,140-i*10,110-i*26],fill=(94,74,56),outline=INK,width=3) for i in range(3)])
prop("model_t",(256,128),lambda d,s:(d.rounded_rectangle([30,10,140,66],8,fill=(46,36,27)),
     d.rounded_rectangle([136,34,236,66],6,fill=(46,36,27)),d.rectangle([16,64,244,84],fill=INK),
     d.ellipse([44,80,92,126],fill=INK),d.ellipse([56,92,80,114],fill=ASPHALT),
     d.ellipse([164,80,212,126],fill=INK),d.ellipse([176,92,200,114],fill=ASPHALT)))
prop("shirt",(44,58),lambda d,s:d.polygon([(6,4),(38,4),(42,54),(2,54)],fill=PATINA,outline=INK))
prop("union",(36,58),lambda d,s:d.rounded_rectangle([3,3,33,55],6,fill=CHALK,outline=INK,width=2))
prop("dress",(44,58),lambda d,s:d.polygon([(14,3),(30,3),(42,55),(2,55)],fill=GOLD,outline=INK))
prop("fire_escape",(120,300),lambda d,s:[d.line(seg,fill=(30,24,18),width=6) for seg in
     [(8,12,112,12),(8,108,112,108),(8,204,112,204),(8,292,112,292),(8,12,8,296),(112,12,112,296),(16,108,104,20),(16,204,104,116),(16,292,104,212)]])
prop("window",(56,76),lambda d,s:(d.rectangle([2,2,54,74],fill=(70,96,110),outline=INK,width=4),
     d.line([28,2,28,74],fill=INK,width=3),d.line([2,38,54,38],fill=INK,width=3)))
prop("window_broken",(56,76),lambda d,s:(d.rectangle([2,2,54,74],fill=(30,26,22),outline=INK,width=4),
     [d.line(l,fill=CHALK,width=3) for l in [(28,38,10,12),(28,38,48,16),(28,38,14,64),(28,38,44,60),(28,38,52,40)]]))
prop("lamp",(40,190),lambda d,s:(d.rectangle([17,26,23,186],fill=(36,30,24)),
     d.ellipse([8,4,32,30],fill=GOLD,outline=INK,width=3)))

# app icon 1024
im=Image.new("RGBA",(1024,1024),(*PAPER,255)); d=ImageDraw.Draw(im)
d.rectangle([0,660,1024,1024],fill=ASPHALT)
d.ellipse([292,760,732,930],fill=(62,56,51),outline=INK,width=14)
d.ellipse([372,796,652,894],outline=PATINA,width=10)
d.line([300,880,760,180],fill=BROWNSTONE,width=54)
d.rectangle([560,430,650,500],fill=CHALK)
d.ellipse([560,240,800,480],fill=PINK,outline=INK,width=16)
d.ellipse([610,290,690,370],fill=(255,214,220))
im.save(f"{P}/icon/icon.png")
im.resize((180,180)).save(f"{P}/icon/icon_180.png")
print("assets ok:", sum(len(files) for _,_,files in os.walk(P)))
