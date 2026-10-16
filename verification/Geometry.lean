import Std
namespace Gameverse
structure V3 where
  x : Int
  y : Int
  z : Int
  deriving Repr

def dot (a b : V3) : Int := a.x*b.x+a.y*b.y+a.z*b.z
def normSq (a : V3) : Int := dot a a
def sub (a b : V3) : V3 := ⟨a.x-b.x,a.y-b.y,a.z-b.z⟩
structure Box where
  lo : V3
  hi : V3

def supportAxis (n lo hi : Int) : Int := if 0 ≤ n then n*hi else n*lo
def support (n : V3) (b : Box) : Int :=
  supportAxis n.x b.lo.x b.hi.x + supportAxis n.y b.lo.y b.hi.y + supportAxis n.z b.lo.z b.hi.z

def InScaledBox (p : V3) (b : Box) (k : Int) : Prop :=
  k*b.lo.x ≤ p.x ∧ p.x ≤ k*b.hi.x ∧ k*b.lo.y ≤ p.y ∧ p.y ≤ k*b.hi.y ∧ k*b.lo.z ≤ p.z ∧ p.z ≤ k*b.hi.z

def Gap (p n : V3) (b : Box) : Int := dot n p - support n b

abbrev Certificate (a c n : V3) (b : Box) (radius : Int) : Prop :=
  0 < normSq n ∧ 0 ≤ Gap a n b ∧ 0 ≤ Gap c n b ∧
  radius*radius*normSq n ≤ Gap a n b * Gap a n b ∧
  radius*radius*normSq n ≤ Gap c n b * Gap c n b

theorem cauchy (a p : V3) : dot a p * dot a p ≤ normSq a * normSq p := by
  have h1 := Int.sq_nonneg (a.x*p.y-a.y*p.x)
  have h2 := Int.sq_nonneg (a.x*p.z-a.z*p.x)
  have h3 := Int.sq_nonneg (a.y*p.z-a.z*p.y)
  simp only [dot, normSq] at *
  grind

theorem support_axis_bound (n lo hi p k : Int) (hl : k*lo ≤ p) (hh : p ≤ k*hi) :
    n*p ≤ k*supportAxis n lo hi := by
  unfold supportAxis
  split
  next hn =>
    have h := Int.mul_le_mul_of_nonneg_left hh hn
    grind
  next hn =>
    have h := Int.mul_le_mul_of_nonpos_left (by omega : n ≤ 0) hl
    grind

theorem support_bound (n p : V3) (b : Box) (k : Int) (h : InScaledBox p b k) :
    dot n p ≤ k*support n b := by
  obtain ⟨hx0,hx1,hy0,hy1,hz0,hz1⟩ := h
  have hx := support_axis_bound n.x b.lo.x b.hi.x p.x k hx0 hx1
  have hy := support_axis_bound n.y b.lo.y b.hi.y p.y k hy0 hy1
  have hz := support_axis_bound n.z b.lo.z b.hi.z p.z k hz0 hz1
  simp only [dot, support]
  grind

-- The certificate proves geometric separation in exact homogeneous integer
-- coordinates: every rational point of the box is outside the open radius ball.
-- k is the common positive denominator; no floating-point axiom is used.
theorem plane_sound (n center p : V3) (b : Box) (radius gap k : Int)
    (hn : 0 < normSq n) (hg : 0 ≤ gap) (hk : 0 ≤ k)
    (hgap : radius*radius*normSq n ≤ gap*gap)
    (hc : k*gap ≤ dot n center-k*support n b)
    (hp : InScaledBox p b k) :
    (k*radius)*(k*radius) ≤ normSq (sub center p) := by
  have hs := support_bound n p b k hp
  have hd : k*gap ≤ dot n (sub center p) := by simp only [dot, sub] at *; grind
  have hkg : 0 ≤ k*gap := Int.mul_nonneg hk hg
  have hsq := Int.mul_self_le_mul_self hkg hd
  have hk2 : 0 ≤ k*k := by have := Int.sq_nonneg k; grind
  have hscaled := Int.mul_le_mul_of_nonneg_left hgap hk2
  have hcs := cauchy n (sub center p)
  have hprod : normSq n * ((k*radius)*(k*radius)) ≤ normSq n * normSq (sub center p) := by grind
  exact Int.le_of_mul_le_mul_left hprod hn

def blend (a c : V3) (t den scale : Int) : V3 :=
  ⟨scale*((den-t)*a.x+t*c.x), scale*((den-t)*a.y+t*c.y), scale*((den-t)*a.z+t*c.z)⟩

-- All rational interpolation parameters, and all rational obstacle points (the
-- extra scale supplies a common denominator), are covered, not only endpoints.
theorem segment_sound (a c n p : V3) (b : Box) (radius t den scale : Int)
    (cert : Certificate a c n b radius) (ht : 0 ≤ t) (htd : t ≤ den)
    (hd : 0 < den) (hscale : 0 < scale)
    (hp : InScaledBox p b (scale*den)) :
    ((scale*den)*radius)*((scale*den)*radius) ≤ normSq (sub (blend a c t den scale) p) := by
  obtain ⟨hn,ha,hc,hra,hrc⟩ := cert
  let gap := min (Gap a n b) (Gap c n b)
  have hga : gap ≤ Gap a n b := Int.min_le_left _ _
  have hgc : gap ≤ Gap c n b := Int.min_le_right _ _
  have hg : 0 ≤ gap := by simp only [gap]; omega
  have hgr : radius*radius*normSq n ≤ gap*gap := by
    by_cases h : Gap a n b ≤ Gap c n b
    · simpa [gap, Int.min_eq_left h] using hra
    · simpa [gap, Int.min_eq_right (by omega : Gap c n b ≤ Gap a n b)] using hrc
  have hleft := Int.mul_le_mul_of_nonneg_left hga (by omega : 0 ≤ den-t)
  have hright := Int.mul_le_mul_of_nonneg_left hgc ht
  have hboth : den*gap ≤ (den-t)*Gap a n b+t*Gap c n b := by grind
  have hs := Int.mul_le_mul_of_nonneg_left hboth (by omega : 0 ≤ scale)
  have hcenter : (scale*den)*gap ≤ dot n (blend a c t den scale) - (scale*den)*support n b := by
    simp only [Gap, dot, blend] at *
    grind
  exact plane_sound n (blend a c t den scale) p b radius gap (scale*den) hn hg
    (Int.mul_nonneg (by omega) (by omega)) hgr hcenter hp

#print axioms cauchy
#print axioms plane_sound
#print axioms segment_sound
end Gameverse
