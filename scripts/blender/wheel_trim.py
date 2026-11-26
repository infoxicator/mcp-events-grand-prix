"""Forged spoke faces in wheel-local metres, from hub flange to bead seat."""
import math

def spoke_faces(sectors=64):
    vertices, faces, colours = [], [], []
    for spoke in range(10):
        for branch in [-1, 1]:
            start = len(vertices)
            for radius, spread, width, depth in [
                (.062, .0, .082, -.021), (.101, .015, .063, -.012),
                (.146, .055, .050, -.008), (.193, .110, .041, -.003),
                (.219, .140, .041, -.004)]:
                mid = spoke * math.tau / 10 + branch * spread
                for offset, x, shade in [(-width, -.005, .038),(-width*.55,0,.18),
                                          (width*.55,0,.13),(width,-.005,.025)]:
                    a=mid+offset
                    vertices.append((depth+x,radius*math.cos(a),radius*math.sin(a)))
                    colours.append((shade,shade*.98,shade*.96,1))
            for row in range(4):
                for k in range(3):
                    a=start+4*row+k
                    faces.append((a,a+4,a+5,a+1))
    # A turned bead seat frames the forged dish. Keep the two rim edges broad
    # enough to resolve as separate surfaces at trackside, without a chrome ring.
    for profile in [[(.207,-.006,.10),(.215,-.004,.22),(.222,-.007,.33),
                     (.226,-.014,.18),(.231,-.021,.065)],
                    [(.045,-.014,.12),(.050,-.009,.25),(.058,-.011,.19),(.066,-.021,.07)]]:
        start=len(vertices)
        for radius,depth,shade in profile:
            for i in range(sectors):
                a=math.tau*i/sectors
                vertices.append((depth,radius*math.cos(a),radius*math.sin(a)))
                colours.append((shade,shade*.98,shade*.96,1))
        for j in range(len(profile)-1):
            for i in range(sectors):
                k=start+j*sectors+i;n=start+j*sectors+(i+1)%sectors
                faces.append((k,n,n+sectors,k+sectors))
    return vertices,faces,colours
