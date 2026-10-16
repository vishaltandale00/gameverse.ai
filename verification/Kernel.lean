import Geometry
namespace Gameverse
-- This is the source language of the executable safety kernel. Only exact
-- integer arithmetic and comparisons occur; proposals/rounding live outside it.
inductive IExpr where
  | input : Nat → IExpr
  | number : Int → IExpr
  | add : IExpr → IExpr → IExpr
  | sub : IExpr → IExpr → IExpr
  | mul : IExpr → IExpr → IExpr
  | nonneg : IExpr → IExpr → IExpr → IExpr
  deriving Repr
inductive BExpr where
  | le : IExpr → IExpr → BExpr
  | lt : IExpr → IExpr → BExpr
  | both : BExpr → BExpr → BExpr
  deriving Repr

def evalI (env : Nat → Int) : IExpr → Int
  | .input i => env i
  | .number n => n
  | .add a b => evalI env a + evalI env b
  | .sub a b => evalI env a - evalI env b
  | .mul a b => evalI env a * evalI env b
  | .nonneg n a b => if 0 ≤ evalI env n then evalI env a else evalI env b

def evalB (env : Nat → Int) : BExpr → Bool
  | .le a b => decide (evalI env a ≤ evalI env b)
  | .lt a b => decide (evalI env a < evalI env b)
  | .both a b => evalB env a && evalB env b

-- The target models the exact ECMAScript BigInt subset printed below. The
-- correspondence to the actual JS engine and the syntax printer is the TCB.
inductive JSExpr where
  | argument : Nat → JSExpr
  | bigint : Int → JSExpr
  | plus : JSExpr → JSExpr → JSExpr
  | minus : JSExpr → JSExpr → JSExpr
  | times : JSExpr → JSExpr → JSExpr
  | ifLe : JSExpr → JSExpr → JSExpr → JSExpr → JSExpr

def evalJS (env : Nat → Int) : JSExpr → Int
  | .argument i => env i
  | .bigint n => n
  | .plus a b => evalJS env a + evalJS env b
  | .minus a b => evalJS env a - evalJS env b
  | .times a b => evalJS env a * evalJS env b
  | .ifLe a b yes no => if evalJS env a ≤ evalJS env b then evalJS env yes else evalJS env no

def compileI : IExpr → JSExpr
  | .input i => .argument i
  | .number n => .bigint n
  | .add a b => .plus (compileI a) (compileI b)
  | .sub a b => .minus (compileI a) (compileI b)
  | .mul a b => .times (compileI a) (compileI b)
  | .nonneg n a b => .ifLe (.bigint 0) (compileI n) (compileI a) (compileI b)

def compileB : BExpr → JSExpr
  | .le a b => .ifLe (compileI a) (compileI b) (.bigint 1) (.bigint 0)
  | .lt a b => .ifLe (compileI b) (compileI a) (.bigint 0) (.bigint 1)
  | .both a b => .times (compileB a) (compileB b)

theorem compileI_correct (env : Nat → Int) (e : IExpr) : evalJS env (compileI e) = evalI env e := by
  induction e <;> simp_all [compileI, evalJS, evalI]

theorem compileB_correct (env : Nat → Int) (e : BExpr) :
    evalJS env (compileB e) = if evalB env e then 1 else 0 := by
  induction e with
  | le a b => simp [compileB, evalJS, compileI_correct, evalB]
  | lt a b => simp [compileB, evalJS, compileI_correct, evalB]; omega
  | both a b ha hb =>
    simp only [compileB, evalJS, ha, hb, evalB]
    by_cases ha' : evalB env a = true <;> by_cases hb' : evalB env b = true <;> simp_all

open IExpr in
def dotExpr (i j : Nat) : IExpr :=
  add (add (mul (input i) (input j)) (mul (input (i+1)) (input (j+1)))) (mul (input (i+2)) (input (j+2)))
open IExpr in
def supportExpr : IExpr :=
  let axis := fun i => nonneg (input (13+i)) (mul (input (13+i)) (input (9+i))) (mul (input (13+i)) (input (6+i)))
  add (add (axis 0) (axis 1)) (axis 2)
open IExpr in
def separatorExpr : BExpr :=
  let norm := dotExpr 13 13
  let ga := IExpr.sub (dotExpr 13 0) supportExpr
  let gc := IExpr.sub (dotExpr 13 3) supportExpr
  let rr := mul (mul (input 12) (input 12)) norm
  .both (.lt (number 0) norm)
    (.both (.le (number 0) ga) (.both (.le (number 0) gc)
      (.both (.le rr (mul ga ga)) (.le rr (mul gc gc)))))

def readV (env : Nat → Int) (i : Nat) : V3 := ⟨env i,env (i+1),env (i+2)⟩
def readBox (env : Nat → Int) : Box := ⟨readV env 6,readV env 9⟩

theorem separatorExpr_spec (env : Nat → Int) :
    evalB env separatorExpr = decide (Certificate (readV env 0) (readV env 3) (readV env 13) (readBox env) (env 12)) := by
  simp [separatorExpr, evalB, evalI, dotExpr, supportExpr, Certificate, Gap, normSq, dot, support, supportAxis, readV, readBox]
  rfl

theorem generated_separator_sound (env : Nat → Int) (p : V3) (t den scale : Int)
    (accepted : evalJS env (compileB separatorExpr) = 1)
    (ht : 0 ≤ t) (htd : t ≤ den) (hd : 0 < den) (hs : 0 < scale)
    (hp : InScaledBox p (readBox env) (scale*den)) :
    ((scale*den)*env 12)*((scale*den)*env 12) ≤
      normSq (sub (blend (readV env 0) (readV env 3) t den scale) p) := by
  have cert : Certificate (readV env 0) (readV env 3) (readV env 13) (readBox env) (env 12) := by
    rw [compileB_correct, separatorExpr_spec] at accepted
    split at accepted
    next h => exact of_decide_eq_true h
    next => contradiction
  exact segment_sound _ _ _ _ _ _ _ _ _ cert ht htd hd hs hp

open IExpr in
def boundsExpr : BExpr :=
  .both (.le (add (input 3) (input 2)) (input 0))
    (.both (.le (add (input 0) (input 2)) (input 4))
      (.both (.le (add (input 5) (input 2)) (input 1)) (.le (add (input 1) (input 2)) (input 6))))

theorem generated_bounds_sound (env : Nat → Int)
    (accepted : evalJS env (compileB boundsExpr) = 1) :
    env 3 + env 2 ≤ env 0 ∧ env 0 + env 2 ≤ env 4 ∧ env 5 + env 2 ≤ env 1 ∧ env 1 + env 2 ≤ env 6 := by
  rw [compileB_correct] at accepted
  simp [boundsExpr, evalB, evalI] at accepted
  exact ⟨of_decide_eq_true accepted.1, of_decide_eq_true accepted.2.1, of_decide_eq_true accepted.2.2.1, of_decide_eq_true accepted.2.2.2⟩

-- A non-axis-aligned rounded-corner path is accepted: its endpoint lies inside
-- the radius-expanded square but outside the radius-four disk around the corner.
example : evalJS (fun i => ([(-7 : Int),0,-3,-3,0,-3,0,0,0,4,0,4,4,-1,0,-1][i]?).getD 0)
    (compileB separatorExpr) = 1 := by decide

def worldAccepted (queries : List (Nat → Int)) : Bool :=
  queries.all (fun env => decide (evalJS env (compileB separatorExpr) = 1))

theorem generated_world_sound (queries : List (Nat → Int)) (env : Nat → Int)
    (accepted : worldAccepted queries = true) (member : env ∈ queries)
    (p : V3) (t den scale : Int) (ht : 0 ≤ t) (htd : t ≤ den) (hd : 0 < den) (hs : 0 < scale)
    (hp : InScaledBox p (readBox env) (scale*den)) :
    ((scale*den)*env 12)*((scale*den)*env 12) ≤
      normSq (sub (blend (readV env 0) (readV env 3) t den scale) p) := by
  have each := List.all_eq_true.mp accepted
  have h := of_decide_eq_true (each env member)
  exact generated_separator_sound env p t den scale h ht htd hd hs hp

def printJS : JSExpr → String
  | .argument i => s!"a[{i}]"
  | .bigint n => s!"({n}n)"
  | .plus a b => s!"({printJS a}+{printJS b})"
  | .minus a b => s!"({printJS a}-{printJS b})"
  | .times a b => s!"({printJS a}*{printJS b})"
  | .ifLe a b yes no => s!"({printJS a}<={printJS b}?{printJS yes}:{printJS no})"

def generatedModule : String :=
  "// GENERATED by verification/Kernel.lean; do not edit.\n" ++
  "// Exact BigInt separator: args = start XYZ, end XYZ, box low XYZ, high XYZ, radius, normal XYZ.\n" ++
  "export function certifiedSeparator(a) {\n  return " ++ printJS (compileB separatorExpr) ++ " === 1n;\n}\n" ++
  "export function certifiedBounds(a) {\n  return " ++ printJS (compileB boundsExpr) ++ " === 1n;\n}\n" ++
  "export function certifiedWorld(queries) { return queries.every(certifiedSeparator); }\n"

#print axioms compileI_correct
#print axioms compileB_correct
#print axioms separatorExpr_spec
#print axioms generated_separator_sound
#print axioms generated_bounds_sound
#print axioms generated_world_sound
end Gameverse
