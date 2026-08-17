#!/usr/bin/env python3
"""THREE SEWERS — the one-point perspective the whole game is drawn in.

The camera stands behind the batter and looks up the street. Home is at the
bottom of the screen, big; the far end of the block converges on a vanishing
point near the horizon.

Gameplay still happens in the flat world coordinates that Tuning defines and
that match_core was soak-tested against — nothing here changes the rules. This
module only says where a world point lands on screen and how big it is, and
the same maths is mirrored in match_view.gd so the baked backdrop and the live
sprites agree exactly.

    u = 0 at the near kerb (STREET_BOT), 1 at the far end (STREET_TOP)
    z = 1 + u * (Z_FAR - 1)          camera-space depth
    s = 1 / z                        everything scales by this
    sy = horizon + (near_bottom - horizon) * s
    sx = cx + (world_x - 640) * s * XK
"""

STREET_TOP = 600.0
STREET_BOT = 2600.0
PLATE_X = 640.0


class View:
    """A projection preset. Design-space pixels, before any retina factor."""

    def __init__(self, name, dw, dh, horizon_f, near_f, z_far, xk, near_y):
        self.name = name
        self.dw = dw                    # design width
        self.dh = dh                    # design height
        self.horizon = dh * horizon_f   # vanishing point height
        self.near_bottom = dh * near_f  # where the nearest ground row lands
        self.z_far = z_far
        self.xk = xk                    # world units -> design px at the near plane
        # The camera stands just behind the batter, not at the far kerb. How
        # close it is decides everything: the biggest depth ratio the view can
        # ever show is 1 / u(batter), so a distant camera can never make the
        # foreground batter loom the way the reference art does.
        self.near_y = near_y

    # -- the projection ------------------------------------------------
    def u_of_y(self, world_y):
        u = (self.near_y - world_y) / (self.near_y - STREET_TOP)
        return min(max(u, 0.004), 1.15)

    def s_of_u(self, u):
        return 1.0 / (1.0 + u * (self.z_far - 1.0))

    def s_of_y(self, world_y):
        return self.s_of_u(self.u_of_y(world_y))

    def project(self, world_x, world_y, height=0.0):
        """world (x, y, h) -> (screen_x, screen_y, scale)."""
        s = self.s_of_y(world_y)
        sy = self.horizon + (self.near_bottom - self.horizon) * s
        sx = self.dw * 0.5 + (world_x - PLATE_X) * s * self.xk
        return sx, sy - height * s * self.xk, s

    # -- inverse, for rasterising the ground plane ---------------------
    def s_of_screen_y(self, sy):
        span = self.near_bottom - self.horizon
        return (sy - self.horizon) / span if span else 0.0

    def world_x_of(self, sx, s):
        if s <= 1e-6:
            return 1e9
        return PLATE_X + (sx - self.dw * 0.5) / (s * self.xk)

    def world_y_of_s(self, s):
        if s <= 1e-6:
            return STREET_TOP
        u = (1.0 / s - 1.0) / (self.z_far - 1.0)
        return self.near_y - u * (self.near_y - STREET_TOP)

    def s_of_wall_screen_x(self, sx, wall_world_x):
        """For a wall at constant world x, screen x alone fixes the depth."""
        denom = (wall_world_x - PLATE_X) * self.xk
        if abs(denom) < 1e-6:
            return 0.0
        return (sx - self.dw * 0.5) / denom

    def sprite_scale(self, s):
        """Sprites are authored at 2x world size, hence the 0.5."""
        return s * self.xk * 0.5


# The two presets the game ships with. Portrait is the reference composition;
# landscape sits the horizon lower and widens the gain so the same street
# reads on a short, wide screen.
PORTRAIT = View("portrait", 720, 1200,
                horizon_f=0.255, near_f=1.52, z_far=74.0, xk=8.56, near_y=2400.0)
LANDSCAPE = View("landscape", 1280, 720,
                 horizon_f=0.230, near_f=1.58, z_far=10.3, xk=1.71, near_y=2400.0)

VIEWS = {"portrait": PORTRAIT, "landscape": LANDSCAPE}
