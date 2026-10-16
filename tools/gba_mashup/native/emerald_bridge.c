/* Native encounter bridge. Emerald definitions in generated/ are source
 * extractions, not mechanics reconstructed from descriptions. The state and
 * sequencing below are an explicit cross-game adaptation; see README. */
#include "emerald_bridge.h"
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef signed int s32;

#include "generated/emerald_constants.h"
#define ARRAY_COUNT(a) (sizeof(a) / sizeof((a)[0]))
#define FALSE 0
#define TRUE 1
#define IS_TYPE_PHYSICAL(type) ((type) < TYPE_MYSTERY)
#define IS_TYPE_SPECIAL(type) ((type) > TYPE_MYSTERY)
#define IS_BATTLER_OF_TYPE(battler,type) (gBattleMons[battler].types[0] == (type) || gBattleMons[battler].types[1] == (type))
#define TYPE_EFFECT_ATK_TYPE(i) gTypeEffectiveness[(i)]
#define TYPE_EFFECT_DEF_TYPE(i) gTypeEffectiveness[(i)+1]
#define TYPE_EFFECT_MULTIPLIER(i) gTypeEffectiveness[(i)+2]
#define ABILITY_ON_FIELD2(id) AbilityBattleEffects(ABILITYEFFECT_FIELD_SPORT,0,(id),0,0)
/* Avoid exporting generic Emerald names into MZM's link namespace. */
#define CalculateBaseDamage GvEmeraldCalculateBaseDamage
#define TypeCalc GvEmeraldTypeCalc
#define gBattleMoves gvEmeraldMoves
#define gStatStageRatios gvEmeraldStatStageRatios
#define gTypeEffectiveness gvEmeraldTypeEffectiveness

struct BattleMove {
    u8 effect, power, type, accuracy, pp, secondaryEffectChance;
    u8 target;
    signed char priority;
    u8 flags;
};
struct BattlePokemon {
    u16 species, attack, defense, spAttack, spDefense, hp, maxHP, item;
    u8 types[2], level, ability, statStages[8];
    u32 status1, status2;
};
struct GvSpeciesSeed {
    const char *name;
    u16 species;
    u8 types[2], stats[6], ability;
};
struct GvFlags { u8 flags[2]; };
struct GvResources { struct GvFlags *flags; };
static struct GvFlags gvResourceFlags;
static struct GvResources gvResources;
static struct GvResources *gBattleResources;
static struct {u8 holdEffect, holdEffectParam;} gEnigmaBerries[2];
static struct BattlePokemon gBattleMons[2];
static u16 gBattleMovePower, gCurrentMove, gBattleWeather;
static u8 gCritMultiplier;
static u32 gBattleTypeFlags;
static s32 gBattleMoveDamage;
static GvBattle *gvCurrent;

/* The adapter's declared capability set excludes held items, gym badges,
 * doubles and field sports. These helpers describe that empty context.
 * It never accepts arbitrary Emerald battler states. */
static u8 GetItemHoldEffect(u16 item) { (void)item; return 0; }
static u8 GetItemHoldEffectParam(u16 item) { (void)item; return 0; }
static u8 ShouldGetStatBadgeBoost(u16 flag, u8 battler) { (void)flag; (void)battler; return FALSE; }
static u8 CountAliveMonsInBattle(u8 side) { (void)side; return 1; }
static u8 AttacksThisTurn(u8 battler, u16 move) { (void)battler; (void)move; return 2; }
static u8 AbilityBattleEffects(u8 effect, u8 battler, u8 ability, u8 sport, u16 move)
{
    (void)effect; (void)battler; (void)sport; (void)move;
    return ability != 0 && (gBattleMons[0].ability == ability || gBattleMons[1].ability == ability);
}
/* Emerald's LCRNG transition from src/random.c, isolated per encounter. */
static u16 Random(void)
{
    gvCurrent->rng = 1103515245 * gvCurrent->rng + 24691;
    return gvCurrent->rng >> 16;
}

#include "generated/emerald_extracts.inc"
#include "generated/emerald_sprites.inc"
#include "generated/emerald_field_sprites.inc"

static const u16 gvLoadouts[3][4] = {
    {MOVE_TACKLE, MOVE_VINE_WHIP, MOVE_RAZOR_LEAF, MOVE_MEGA_DRAIN},
    {MOVE_SCRATCH, MOVE_EMBER, MOVE_FLAMETHROWER, MOVE_QUICK_ATTACK},
    {MOVE_POUND, MOVE_WATER_GUN, MOVE_QUICK_ATTACK, MOVE_SURF}
};

const char *GvMoveName(u16 move)
{
    switch(move) {
    case MOVE_TACKLE: return "TACKLE";
    case MOVE_VINE_WHIP: return "VINE WHIP";
    case MOVE_RAZOR_LEAF: return "RAZOR LEAF";
    case MOVE_MEGA_DRAIN: return "MEGA DRAIN";
    case MOVE_SCRATCH: return "SCRATCH";
    case MOVE_EMBER: return "EMBER";
    case MOVE_FLAMETHROWER: return "FLAMETHROWER";
    case MOVE_QUICK_ATTACK: return "QUICK ATTACK";
    case MOVE_POUND: return "POUND";
    case MOVE_WATER_GUN: return "WATER GUN";
    case MOVE_BUBBLE: return "BUBBLE";
    case MOVE_SURF: return "SURF";
    case MOVE_STRUGGLE: return "STRUGGLE";
    case MOVE_BITE: return "BITE";
    case MOVE_WING_ATTACK: return "WING ATTACK";
    case MOVE_LEECH_LIFE: return "LEECH LIFE";
    case MOVE_ROCK_THROW: return "ROCK THROW";
    case MOVE_MUD_SLAP: return "MUD SLAP";
    case MOVE_ABSORB: return "ABSORB";
    case MOVE_PECK: return "PECK";
    default: return "UNKNOWN";
    }
}
u8 GvMoveType(u16 move) { return move < MOVES_COUNT ? gBattleMoves[move].type : TYPE_NORMAL; }
u8 GvMovePower(u16 move) { return move < MOVES_COUNT ? gBattleMoves[move].power : 0; }
const char *GvTypeName(u8 type)
{
    static const char * const names[18] = {"NORMAL","FIGHT","FLYING","POISON","GROUND","ROCK","BUG","GHOST","STEEL","???","FIRE","WATER","GRASS","ELECTRIC","PSYCHIC","ICE","DRAGON","DARK"};
    return type < 18 ? names[type] : "UNKNOWN";
}

static void GvLoadMon(struct BattlePokemon *out, const GvCombatant *in)
{
    u8 i;
    out->species = in->species;
    out->attack = in->attack; out->defense = in->defense;
    out->spAttack = in->spAttack; out->spDefense = in->spDefense;
    out->hp = in->hp; out->maxHP = in->maxHP; out->item = 0;
    out->types[0] = in->types[0]; out->types[1] = in->types[1];
    out->level = in->level; out->ability = in->ability;
    out->status1 = in->status1; out->status2 = 0;
    for(i=0;i<8;i++) out->statStages[i] = DEFAULT_STAT_STAGE;
}

static u16 GvDamage(GvBattle *state, GvCombatant *attacker, GvCombatant *defender, u16 move, u8 real)
{
    u8 flags;
    gvCurrent = state;
    gvResources.flags = &gvResourceFlags;
    gBattleResources = &gvResources;
    gvResourceFlags.flags[0] = gvResourceFlags.flags[1] = 0;
    GvLoadMon(&gBattleMons[0], attacker);
    GvLoadMon(&gBattleMons[1], defender);
    gBattleWeather = state->weather;
    gBattleTypeFlags = 0;
    gCurrentMove = move;
    gCritMultiplier = real && Random() % (gBattleMoves[move].effect == EFFECT_HIGH_CRITICAL ? 8 : 16) == 0 ? 2 : 1;
    gBattleMoveDamage = CalculateBaseDamage(&gBattleMons[0], &gBattleMons[1], move, 0, 0, 0, 0, 1);
    gBattleMoveDamage *= gCritMultiplier;
    flags = TypeCalc(move, 0, 1);
    if(flags & (MOVE_RESULT_MISSED | MOVE_RESULT_DOESNT_AFFECT_FOE))
        return 0;
    if(real) ApplyRandomDmgMultiplier();
    return gBattleMoveDamage > 65535 ? 65535 : gBattleMoveDamage;
}

static u8 GvFirstHealthy(GvCombatant *party)
{
    u8 i;
    for(i=0;i<3;i++) if(party[i].hp) return i;
    return 3;
}

void GvBattleBegin(GvBattle *state, u32 seed, u8 area)
{
    u8 side, i, j;
    GvCombatant *mon;
    const struct GvSpeciesSeed *info;
    state->magic = 0x47564231;
    state->active = 1; state->result = 0; state->turn = 0;
    state->rng = seed ? seed : 1;
    state->weather = area % 3 == 1 ? B_WEATHER_RAIN_TEMPORARY : area % 3 == 2 ? B_WEATHER_SUN_TEMPORARY : 0;
    state->playerIndex = 0;
    state->enemyIndex = (seed + area) % 3;
    state->lastPlayerMove = state->lastEnemyMove = state->lastDamage = 0;
    for(side=0;side<2;side++) for(i=0;i<3;i++) {
        mon = side ? &state->enemy[i] : &state->player[i];
        info = &gvSpeciesSeeds[i];
        mon->name = info->name; mon->species = info->species;
        mon->types[0] = info->types[0]; mon->types[1] = info->types[1];
        mon->ability = info->ability;
        mon->level = 20 + (area % 4) * 2;
        /* Neutral nature, no EVs, IV=15. Deliberate encounter configuration. */
        mon->maxHP = (2 * info->stats[0] + 15) * mon->level / 100 + mon->level + 10;
        mon->hp = mon->maxHP;
        mon->attack = (2 * info->stats[1] + 15) * mon->level / 100 + 5;
        mon->defense = (2 * info->stats[2] + 15) * mon->level / 100 + 5;
        mon->spAttack = (2 * info->stats[3] + 15) * mon->level / 100 + 5;
        mon->spDefense = (2 * info->stats[4] + 15) * mon->level / 100 + 5;
        mon->speed = (2 * info->stats[5] + 15) * mon->level / 100 + 5;
        mon->status1 = 0;
        for(j=0;j<4;j++) { mon->moves[j] = gvLoadouts[i][j]; mon->pp[j] = gBattleMoves[mon->moves[j]].pp; }
    }
}

/* Wild adaptation: one source-linked opponent; player HP/PP/status survive
 * the transition. Only a fresh party or explicit rescue initializes members. */
void GvBattleBeginWild(GvBattle *state, u32 seed, u8 area, u16 species, u8 preserveParty)
{
    GvCombatant saved[3];
    const struct GvSpeciesSeed *info=0;
    GvCombatant *mon;
    u16 moves[4];
    u8 i,j,index=state->playerIndex;
    if(preserveParty && state->magic==0x47564231)
        for(i=0;i<3;i++)saved[i]=state->player[i];
    else preserveParty=0;
    GvBattleBegin(state,seed,area);
    if(preserveParty) {
        for(i=0;i<3;i++)state->player[i]=saved[i];
        state->playerIndex=index<3 && state->player[index].hp?index:GvFirstHealthy(state->player);
    }
    for(i=0;i<ARRAY_COUNT(gvSpeciesSeeds);i++)if(gvSpeciesSeeds[i].species==species)info=&gvSpeciesSeeds[i];
    if(!info)info=&gvSpeciesSeeds[3];
    mon=&state->enemy[0];
    mon->name=info->name;mon->species=info->species;
    mon->types[0]=info->types[0];mon->types[1]=info->types[1];mon->ability=info->ability;
    mon->level=14+(area%4)*2;
    mon->maxHP=(2*info->stats[0]+15)*mon->level/100+mon->level+10;mon->hp=mon->maxHP;
    mon->attack=(2*info->stats[1]+15)*mon->level/100+5;
    mon->defense=(2*info->stats[2]+15)*mon->level/100+5;
    mon->spAttack=(2*info->stats[3]+15)*mon->level/100+5;
    mon->spDefense=(2*info->stats[4]+15)*mon->level/100+5;
    mon->speed=(2*info->stats[5]+15)*mon->level/100+5;mon->status1=0;
    moves[0]=MOVE_TACKLE;moves[1]=MOVE_QUICK_ATTACK;moves[2]=MOVE_BITE;moves[3]=MOVE_SCRATCH;
    switch(mon->species) {
    case SPECIES_ZUBAT: moves[0]=MOVE_LEECH_LIFE;moves[1]=MOVE_WING_ATTACK;break;
    case SPECIES_GEODUDE: moves[0]=MOVE_ROCK_THROW;moves[1]=MOVE_MUD_SLAP;break;
    case SPECIES_PARAS: moves[0]=MOVE_ABSORB;moves[1]=MOVE_LEECH_LIFE;break;
    case SPECIES_WINGULL: moves[0]=MOVE_WATER_GUN;moves[1]=MOVE_WING_ATTACK;break;
    default: break;
    }
    for(j=0;j<4;j++){mon->moves[j]=moves[j];mon->pp[j]=gBattleMoves[moves[j]].pp;}
    state->enemyIndex=0;
    for(i=1;i<3;i++){state->enemy[i].hp=0;state->enemy[i].maxHP=0;state->enemy[i].species=0;}
}

void GvBattleRescueParty(GvBattle *state)
{
    u8 i,j;
    for(i=0;i<3;i++) {
        state->player[i].hp=state->player[i].maxHP;state->player[i].status1=0;
        for(j=0;j<4;j++)state->player[i].pp[j]=gBattleMoves[state->player[i].moves[j]].pp;
    }
    state->playerIndex=0;
}

static u16 GvBestMove(GvBattle *state, GvCombatant *a, GvCombatant *d, u8 *slot)
{
    u8 i, count=0;
    u8 ties[4];
    u16 score, best=0;
    for(i=0;i<4;i++) if(a->pp[i]) {
        score = GvDamage(state,a,d,a->moves[i],0);
        if(!count || score > best) { best=score; count=0; }
        if(score==best) ties[count++]=i;
    }
    *slot = count ? ties[Random()%count] : 0;
    return best;
}

u8 GvBattleChooseEnemyAction(GvBattle *state)
{
    u8 slot, i, bestIndex;
    u16 current, candidate, best;
    GvCombatant *opponent=&state->player[state->playerIndex];
    GvCombatant *active=&state->enemy[state->enemyIndex];
    gvCurrent=state;
    if(!active->hp) return 4+GvFirstHealthy(state->enemy);
    current=GvBestMove(state,active,opponent,&slot);
    best=current; bestIndex=state->enemyIndex;
    /* Declared adaptation: damage-based switch first, then move. Native Emerald
     * has a much larger ordered switching/item policy and script interpreter. */
    for(i=0;i<3;i++) if(i!=state->enemyIndex && state->enemy[i].hp) {
        u8 unused;
        candidate=GvBestMove(state,&state->enemy[i],opponent,&unused);
        if(candidate>best*2 && candidate>opponent->hp/2) { best=candidate; bestIndex=i; }
    }
    if(bestIndex!=state->enemyIndex) return 4+bestIndex;
    return slot;
}

static u8 GvHasPP(GvCombatant *mon)
{
    return mon->pp[0] || mon->pp[1] || mon->pp[2] || mon->pp[3];
}

static void GvAttack(GvBattle *state, u8 side, u8 slot)
{
    GvCombatant *a = side ? &state->enemy[state->enemyIndex] : &state->player[state->playerIndex];
    GvCombatant *d = side ? &state->player[state->playerIndex] : &state->enemy[state->enemyIndex];
    u16 move, damage, heal;
    u8 effect;
    if(!a->hp || !d->hp) return;
    if((a->status1 & STATUS1_PARALYSIS) && Random()%4==0) return;
    move = GvHasPP(a) ? a->moves[slot] : MOVE_STRUGGLE;
    if(move!=MOVE_STRUGGLE) a->pp[slot]--;
    if(side) state->lastEnemyMove=move; else state->lastPlayerMove=move;
    if(gBattleMoves[move].accuracy && Random()%100 >= gBattleMoves[move].accuracy) {state->lastDamage=0; return;}
    damage=GvDamage(state,a,d,move,1);
    if(damage>d->hp) damage=d->hp;
    d->hp-=damage; state->lastDamage=damage;
    effect=gBattleMoves[move].effect;
    if(damage && effect==EFFECT_ABSORB) {
        heal=damage/2; if(!heal)heal=1;
        a->hp=a->hp+heal>a->maxHP?a->maxHP:a->hp+heal;
    }
    if(d->hp && damage && !d->status1 && Random()%100<gBattleMoves[move].secondaryEffectChance) {
        if(effect==EFFECT_BURN_HIT && d->types[0]!=TYPE_FIRE && d->types[1]!=TYPE_FIRE) d->status1=STATUS1_BURN;
        if(effect==EFFECT_PARALYZE_HIT && d->types[0]!=TYPE_ELECTRIC && d->types[1]!=TYPE_ELECTRIC) d->status1=STATUS1_PARALYSIS;
    }
    if(move==MOVE_STRUGGLE) { damage=a->maxHP/4; if(!damage)damage=1; a->hp=a->hp>damage?a->hp-damage:0; }
}

static u16 GvSpeed(GvCombatant *a) { return a->status1 & STATUS1_PARALYSIS ? a->speed/4 : a->speed; }
static void GvBurn(GvCombatant *a)
{
    u16 damage;
    if(a->hp && (a->status1 & STATUS1_BURN)) {damage=a->maxHP/8; if(!damage)damage=1; a->hp=a->hp>damage?a->hp-damage:0;}
}

u8 GvBattleTurn(GvBattle *state, u8 action)
{
    u8 enemy, first, next;
    signed char pPriority, ePriority;
    GvCombatant *p, *e;
    if(state->magic!=0x47564231 || !state->active || state->result || action>6) return 0;
    gvCurrent=state;
    p=&state->player[state->playerIndex]; e=&state->enemy[state->enemyIndex];
    if(!p->hp) {
        if(action<4 || action-4==state->playerIndex || !state->player[action-4].hp) return 0;
        state->playerIndex=action-4;
        return 1;
    }
    if(action<4 && !p->pp[action] && GvHasPP(p)) return 0;
    if(action>=4 && (action-4==state->playerIndex || !state->player[action-4].hp)) return 0;
    enemy=GvBattleChooseEnemyAction(state);
    state->lastDamage=0; state->lastPlayerMove=state->lastEnemyMove=0;
    if(action>=4) state->playerIndex=action-4;
    if(enemy>=4 && enemy<7) state->enemyIndex=enemy-4;
    p=&state->player[state->playerIndex]; e=&state->enemy[state->enemyIndex];
    if(action>=4) { if(enemy<4) GvAttack(state,1,enemy); }
    else if(enemy>=4) GvAttack(state,0,action);
    else {
        pPriority=gBattleMoves[p->moves[action]].priority; ePriority=gBattleMoves[e->moves[enemy]].priority;
        first = pPriority>ePriority ? 0 : pPriority<ePriority ? 1 : GvSpeed(p)>GvSpeed(e) ? 0 : GvSpeed(p)<GvSpeed(e) ? 1 : Random()%2;
        GvAttack(state,first,first?enemy:action);
        GvAttack(state,!first,first?action:enemy);
    }
    GvBurn(p); GvBurn(e);
    state->turn++;
    next=GvFirstHealthy(state->enemy);
    if(next==3) state->result=1;
    else if(!e->hp) state->enemyIndex=next;
    if(GvFirstHealthy(state->player)==3) state->result=2;
    return 1;
}
