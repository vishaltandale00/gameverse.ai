import Kernel
namespace Gameverse

-- These are runtime acceptance predicates over the same exact integer language
-- as the city geometry kernel. Coordinates and velocities use a 2^16 grid.
open IExpr in
def differenceNorm (new old : Nat) : IExpr :=
  let d := fun i => IExpr.sub (input (new+i)) (input (old+i))
  add (add (mul (d 0) (d 0)) (mul (d 1) (d 1))) (mul (d 2) (d 2))

open IExpr in
def sportsMoveExpr : BExpr :=
  .both (.le (number 0) (input 6))
    (.le (differenceNorm 3 0) (mul (input 6) (input 6)))

theorem generated_sports_move_sound (env : Nat → Int)
    (accepted : evalJS env (compileB sportsMoveExpr) = 1) :
    0 ≤ env 6 ∧ normSq (sub (readV env 3) (readV env 0)) ≤ env 6 * env 6 := by
  rw [compileB_correct] at accepted
  simp [sportsMoveExpr, differenceNorm, evalB, evalI] at accepted
  simpa [normSq, dot, sub, readV] using And.intro (of_decide_eq_true accepted.1) (of_decide_eq_true accepted.2)

def equalExpr (a b : IExpr) : BExpr := .both (.le a b) (.le b a)
def residualExpr (r den : IExpr) : BExpr :=
  .both (.lt (.sub (.number 0) den) r) (.lt r den)

-- A semi-implicit tick: v' = v + acceleration/den, p' = p + v'/den.
-- Division is quantized in the bridge. The checker proves each residual is
-- strictly less than one grid unit after division by the positive denominator.
-- args: p XYZ, v XYZ, p' XYZ, v' XYZ, nonnegative gravity, denominator.
open IExpr in
def sportsFlightExpr : BExpr :=
  let den := input 13
  let pos := fun i => residualExpr (IExpr.sub (mul (IExpr.sub (input (6+i)) (input i)) den) (input (9+i))) den
  .both (.lt (number 0) den) (.both (.le (number 0) (input 12))
    (.both (equalExpr (input 9) (input 3)) (.both (equalExpr (input 11) (input 5))
      (.both (.le (input 10) (input 4))
        (.both (residualExpr (add (mul (IExpr.sub (input 10) (input 4)) den) (input 12)) den)
          (.both (pos 0) (.both (pos 1) (pos 2))))))))

def FlightSpec (e : Nat → Int) : Prop :=
  0 < e 13 ∧ 0 ≤ e 12 ∧ e 9 = e 3 ∧ e 11 = e 5 ∧ e 10 ≤ e 4 ∧
  (-e 13 < (e 10-e 4)*e 13+e 12 ∧ (e 10-e 4)*e 13+e 12 < e 13) ∧
  (-e 13 < (e 6-e 0)*e 13-e 9 ∧ (e 6-e 0)*e 13-e 9 < e 13) ∧
  (-e 13 < (e 7-e 1)*e 13-e 10 ∧ (e 7-e 1)*e 13-e 10 < e 13) ∧
  (-e 13 < (e 8-e 2)*e 13-e 11 ∧ (e 8-e 2)*e 13-e 11 < e 13)

theorem generated_sports_flight_sound (env : Nat → Int)
    (accepted : evalJS env (compileB sportsFlightExpr) = 1) : FlightSpec env := by
  rw [compileB_correct] at accepted
  simp [sportsFlightExpr, equalExpr, residualExpr, evalB, evalI] at accepted
  rcases accepted with ⟨hd,hg,hx,hx2,hz,hz2,hy,ha,hb,px,px2,py,py2,pz,pz2⟩
  have hd' := of_decide_eq_true hd
  have hg' := of_decide_eq_true hg
  have hx' := of_decide_eq_true hx
  have hx2' := of_decide_eq_true hx2
  have hz' := of_decide_eq_true hz
  have hz2' := of_decide_eq_true hz2
  have hy' := of_decide_eq_true hy
  have hb' := of_decide_eq_true hb
  have px2' := of_decide_eq_true px2
  have py2' := of_decide_eq_true py2
  have pz2' := of_decide_eq_true pz2
  unfold FlightSpec
  omega

def sportsCollisionExpr : BExpr := .le (dotExpr 3 3) (dotExpr 0 0)
def sportsFloorExpr : BExpr :=
  .both sportsCollisionExpr (.le (.number 0) (.input 4))

-- Kinetic energy has the common positive mass/2 factor. Bounding norm squared
-- proves dissipation without assuming a floating sqrt, friction, or restitution.
theorem generated_sports_collision_sound (env : Nat → Int)
    (accepted : evalJS env (compileB sportsCollisionExpr) = 1) :
    normSq (readV env 3) ≤ normSq (readV env 0) := by
  rw [compileB_correct] at accepted
  simp [sportsCollisionExpr, dotExpr, evalB, evalI] at accepted
  simpa [normSq, dot, readV] using (of_decide_eq_true accepted)

theorem generated_sports_floor_sound (env : Nat → Int)
    (accepted : evalJS env (compileB sportsFloorExpr) = 1) :
    normSq (readV env 3) ≤ normSq (readV env 0) ∧ 0 ≤ env 4 := by
  rw [compileB_correct] at accepted
  simp [sportsFloorExpr, sportsCollisionExpr, dotExpr, evalB, evalI] at accepted
  simpa [normSq, dot, readV] using And.intro (of_decide_eq_true accepted.1) (of_decide_eq_true accepted.2)

open IExpr in
def sportsPairExpr : BExpr :=
  let momentum := fun i => equalExpr (add (input (6+i)) (input (9+i))) (add (input i) (input (3+i)))
  .both (.le (add (dotExpr 6 6) (dotExpr 9 9)) (add (dotExpr 0 0) (dotExpr 3 3)))
    (.both (momentum 0) (.both (momentum 1) (momentum 2)))

-- Equal-mass contact may give energy to one athlete; it is the pair's total
-- energy and total momentum that must be constrained.
theorem generated_sports_pair_sound (env : Nat → Int)
    (accepted : evalJS env (compileB sportsPairExpr) = 1) :
    normSq (readV env 6) + normSq (readV env 9) ≤ normSq (readV env 0) + normSq (readV env 3) ∧
    env 6 + env 9 = env 0 + env 3 ∧ env 7 + env 10 = env 1 + env 4 ∧ env 8 + env 11 = env 2 + env 5 := by
  rw [compileB_correct] at accepted
  simp [sportsPairExpr, equalExpr, dotExpr, evalB, evalI] at accepted
  rcases accepted with ⟨he,hx,hx2,hy,hy2,hz,hz2⟩
  have he' := of_decide_eq_true he
  have hx' := of_decide_eq_true hx
  have hx2' := of_decide_eq_true hx2
  have hy' := of_decide_eq_true hy
  have hy2' := of_decide_eq_true hy2
  have hz' := of_decide_eq_true hz
  have hz2' := of_decide_eq_true hz2
  simp [normSq, dot, readV]
  omega

-- Reusing segment_sound on the relative center segment and a point obstacle
-- covers all rational interpolation times, not only endpoint distances. The JS
-- bridge supplies relative centers and the sum of the sphere radii.
theorem generated_sports_swept_separation_sound (env : Nat → Int) (t den scale : Int)
    (accepted : evalJS env (compileB separatorExpr) = 1)
    (ht : 0 ≤ t) (htd : t ≤ den) (hd : 0 < den) (hs : 0 < scale)
    (origin : InScaledBox ⟨0,0,0⟩ (readBox env) (scale*den)) :
    ((scale*den)*env 12)*((scale*den)*env 12) ≤
      normSq (sub (blend (readV env 0) (readV env 3) t den scale) ⟨0,0,0⟩) := by
  exact generated_separator_sound env ⟨0,0,0⟩ t den scale accepted ht htd hd hs origin

def generatedSportsModule : String :=
  "// GENERATED by verification/Sports.lean; do not edit.\n" ++
  "// Exact BigInt acceptance kernels; numerical bridge and JS engine are audited TCB.\n" ++
  "export function certifiedSportsMove(a) { return " ++ printJS (compileB sportsMoveExpr) ++ " === 1n; }\n" ++
  "export function certifiedSportsFlight(a) { return " ++ printJS (compileB sportsFlightExpr) ++ " === 1n; }\n" ++
  "export function certifiedSportsCollision(a) { return " ++ printJS (compileB sportsCollisionExpr) ++ " === 1n; }\n" ++
  "export function certifiedSportsFloor(a) { return " ++ printJS (compileB sportsFloorExpr) ++ " === 1n; }\n" ++
  "export function certifiedSportsPair(a) { return " ++ printJS (compileB sportsPairExpr) ++ " === 1n; }\n"

#print axioms generated_sports_move_sound
#print axioms generated_sports_flight_sound
#print axioms generated_sports_collision_sound
#print axioms generated_sports_floor_sound
#print axioms generated_sports_pair_sound
#print axioms generated_sports_swept_separation_sound
end Gameverse
