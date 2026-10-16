// Broad design bundles reference existing component records. They are design
// inputs, not claims that foreign code is interchangeable or already integrated.
export const DIMENSIONS = [
  {id:'traversal',label:'Movement & perspective',question:'How do you inhabit the world?',description:'Viewpoint, movement, camera and the feel of getting somewhere.',icon:'↗',facets:['projection','movement_physics','camera'],pattern:/locomotion|jump_and_gravity|projection|grid_step|movement_collision|scroll_camera/,requires:['A consistent coordinate system','Matching collision and camera rules'],bridges:[['field_and_hubs','Side-view field + top-down hubs'],['keep_foundation_view','Keep the foundation’s view; adapt movement']]},
  {id:'combat',label:'Encounters & combat',question:'What happens when paths collide?',description:'Attacks, decisions, timing and the moment-to-moment stakes.',icon:'×',facets:['mechanics'],pattern:/battle_engine|damage_formula|type_chart|beam_stacking|damage_and_iframes|incoming_damage|red_soul_cast|contact_damage|throw_rock|battle|weapon/,requires:['An encounter entry and exit seam','Shared health and defeat rules'],bridges:[['pause_for_tactics','Explore in real time; pause for tactical battles'],['field_abilities','Keep field combat; borrow abilities and matchups']]},
  {id:'progression',label:'Growth & discovery',question:'What makes a new path possible?',description:'Upgrades, learning, unlocks and reasons to return.',icon:'◇',facets:['progression'],pattern:/ability_gating|typed_locks|hm_field|exp_and_level|evolution|level_growth|gate|upgrade|progression/,requires:['Persistent progression flags','Routes that consume the chosen unlocks'],bridges:[['abilities_as_keys','Companion abilities become exploration keys'],['parallel_growth','Keep world unlocks and team growth separate']]},
  {id:'world',label:'Places & world rules',question:'How does a place change the play?',description:'Weather, hazards, terrain and the structure of discovery.',icon:'⌁',facets:['rendering','progression','movement_physics'],pattern:/overworld_weather|environmental_hazards|liquid_physics|room_transition|sector_hub|tile_collision|water_traversal|map_completion|forced_movement/,requires:['Location and environmental state','Rules for crossing between areas'],bridges:[['regional_rules','Regions carry distinct weather and traversal rules'],['exploration_network','Connect contrasting areas through explicit transitions']]},
  {id:'resources',label:'Companions & resources',question:'What is worth carrying forward?',description:'Your team, equipment, supplies and meaningful tradeoffs.',icon:'⊞',facets:['economy','mechanics'],pattern:/inventory|resource_pools|monster_data|character_equipment|soul_inventory|money|hp_pool|mp_pool|carry_rock|health_pickups/,requires:['A clear owner for each resource','Capacity, recovery and save rules'],bridges:[['team_and_loadout','A companion team alongside a small equipment loadout'],['one_economy','One shared resource loop; adapt costs deliberately']]},
  {id:'opposition',label:'Challenge & opposition',question:'What pushes back against you?',description:'Enemy behavior, tactical choices and the rhythm of challenge.',icon:'↔',facets:['ai'],pattern:/trainer_ai_move|trainer_ai_switch|space_pirate_ai|surface_crawler|spear_|stalker|boss|enemy|npc_movement/,requires:['Readable cues before a threat acts','Challenge rules matched to player abilities'],bridges:[['field_and_trainer','Field hazards plus deliberate trainer encounters'],['adapt_opponents','Keep local enemies; borrow tactical priorities']]},
  {id:'atmosphere',label:'Setting, style & atmosphere',question:'What kind of world stays with you?',description:'Places, palettes, music and the emotional texture between actions.',icon:'✳',facets:['setting','audio','rendering'],pattern:/setting|visual_setting|pixel_gothic|zebes|hoenn|adaptive_music|map_music|parallax|palette/,requires:['A cohesive visual and audio direction','A clear plan for original or permitted assets'],bridges:[['contrasting_regions','Distinct parent-inspired regions, one coherent art direction'],['new_shared_world','An original setting with selected moods from both']]},
  {id:'story',label:'Plot beats & story delivery',question:'Why does the journey matter?',description:'An opening promise, a complication and a destination worth reaching.',icon:'≋',facets:['narrative_delivery'],pattern:/intro_sequence|scripted_story|cutscenes|briefings|intro_scene|intro_vignette|dialogue/,requires:['Story beats tied to observable game events','An outcome that follows the player’s progress'],bridges:[['discovery_escalation','Discovery → new bond → escalating threat → return transformed'],['parallel_threads','Two linked journeys, meeting at a shared turning point']]},
];
const curated = {
 'metroid-zero-mission': {
 traversal:{label:'Fluid side-view movement',ids:['side_view_projection','ground_locomotion','jump_and_gravity','scroll_camera']},
 combat:{label:'Immediate, ability-driven action',ids:['beam_stacking','damage_and_iframes','body_attacks']},
 progression:{label:'New abilities open old paths',ids:['ability_gating_graph','typed_locks','chozo_statue_items_and_hints']},
 world:{label:'Interconnected rooms & hazardous terrain',ids:['environmental_hazards','liquid_physics','parallax_layers']},
 resources:{label:'Equipment, energy & limited ammunition',ids:['resource_pools','enemy_drops']},
 opposition:{label:'Readable field enemies & staged bosses',ids:['surface_crawler_ai','space_pirate_ai','kraid_boss']},
 atmosphere:{label:'Alien ruins, isolation & layered depth',ids:['zebes_setting','parallax_layers','adaptive_music']},
 story:{label:'Discovery, escalation & the timed escape',ids:['intro_sequence','cutscenes','timed_escapes']},
 },
 'pokemon-emerald-version': {
 traversal:{label:'Top-down exploration, one tile at a time',ids:['top_down_oblique_projection','grid_step_locomotion','player_locked_tile_camera']},
 combat:{label:'Team-based turns & elemental matchups',ids:['battle_engine_core','turn_order','type_chart','trainer_ai_move_scoring']},
 progression:{label:'Grow a team; earn access to new places',ids:['exp_and_leveling','evolution_rules','hm_field_move_gating']},
 world:{label:'Regional weather & varied traversal',ids:['overworld_weather_effects','water_traversal','tile_collision_and_elevation']},
 resources:{label:'A companion party, bag & shared supplies',ids:['monster_data_model','inventory_and_storage','money_and_prize']},
 opposition:{label:'Trainer tactics, switches & sight lines',ids:['trainer_ai_move_scoring','trainer_ai_switch_and_items','trainer_line_of_sight']},
 atmosphere:{label:'Tropical routes, towns & changing skies',ids:['hoenn_setting','map_music_and_fanfares','overworld_weather_effects']},
 story:{label:'Rivals, regional stakes & scripted encounters',ids:['scripted_story_events','dialogue_text_printer']},
 },
};
export function bundlesFor(game) {
 return Object.fromEntries(DIMENSIONS.map(d=>{
  const known=curated[game.id]?.[d.id], components=known?known.ids.map(id=>game.components.find(c=>c.id===id)).filter(Boolean):game.components.filter(c=>d.pattern.test(c.id)).slice(0,4);
  if(!components.length&&!known)components.push(...game.components.filter(c=>d.facets.includes(c.facet)).slice(0,3));
  const label=known?.label || (components.length?components[0].label.replace(/\s*\([^)]*\)/g,'').slice(0,75):`${game.shortName}’s ${d.label.toLowerCase()} — to investigate`);
  return[d.id,{label,component_ids:components.map(c=>c.id),components,evidence_status:components.length?'component_references':'research_needed',source_game_id:game.id}];
 }));
}
export function defaultChoices(parents){return Object.fromEntries(DIMENSIONS.map((d,i)=>[d.id,{mode:i>=6?'bridge':'parent',parent_game_id:parents[i===1||i===3||i===4||i===5?1:0]?.id,bridge_id:d.bridges[0][0],notes:''}]));}
export function dependencyNotes(parents,choices,foundationId){
 const result=[];const traversal=choices.traversal,combat=choices.combat;
 const projection=g=>g?.components.find(c=>c.facet==='projection')?.summary||g?.components.find(c=>c.facet==='projection')?.label||'';
 const foundation=parents.find(g=>g.id===foundationId);
 if(traversal?.mode==='bridge'&&traversal.bridge_id==='field_and_hubs')result.push({id:'view_seam',level:'bridge',title:'Two views need a deliberate crossing',text:'Use explicit hub/field transitions. Each view needs its own collision, camera and control rules; preserve shared inventory and progression at the seam.'});
 else if(traversal?.parent_game_id&&traversal.parent_game_id!==foundationId&&projection(foundation)&&projection(parents.find(g=>g.id===traversal.parent_game_id)))result.push({id:'view_conversion',level:'review',title:'Changing perspective affects the whole world',text:'Map geometry, actors, collision and camera must be adapted together. A foundation-preserving build can borrow movement ideas without converting the entire campaign.'});
 if(combat?.mode==='bridge'||combat?.parent_game_id!==foundationId)result.push({id:'combat_seam',level:'bridge',title:'Connect exploration and encounters',text:'Define entry, exit, defeat and restoration behavior. A tactical battle can pause the native field, then return to the same location and world state.'});
 if(choices.progression?.mode==='bridge')result.push({id:'ability_keys',level:'companion',title:'Abilities need somewhere meaningful to work',text:'Pair each new traversal ability with a visible gate, persistent unlock state and a route that can actually use it.'});
 if(choices.resources?.mode==='bridge')result.push({id:'resource_units',level:'review',title:'Reconcile ownership and units',text:'Keep party health, player energy, ammunition and money distinct unless a deliberate conversion rule is chosen. Specify recovery and save behavior.'});
 const missing=parents.filter(g=>!g.components.length);if(missing.length)result.push({id:'missing_evidence',level:'research',title:'Some ingredients still need extraction',text:`${missing.map(g=>g.shortName).join(', ')} can inform the brief, but no component records are available in this snapshot. Research precedes implementation.`});
 result.push({id:'original_direction',level:'creative',title:'One world, a considered direction',text:'Setting, plot beats and style are creative adaptations. Source references describe inspiration; they do not grant asset permissions or establish compatibility.'});
 return result;
}
export function createMashupRequest(catalog,parentIds,choices,intent,foundationId){
 const parents=parentIds.map(id=>catalog.games.find(g=>g.id===id));if(parents.some(g=>!g))throw Error('A selected parent is absent from this snapshot.');if(parents.length<2)throw Error('Choose at least two parent games.');if(parents.length>4)throw Error('Keep this brief to at most four parent games.');if(!parents.some(g=>g.id===foundationId))throw Error('Choose a parent as the foundation.');if(!intent.trim())throw Error('Describe the world you want to make.');if(intent.length>4000)throw Error('Keep the game description within 4,000 characters.');
 const design_choices=DIMENSIONS.filter(d=>choices[d.id]?.mode!=='defer').map(d=>{
 const c=choices[d.id];if(!c)throw Error('Choose how to handle each active dimension.');if((c.notes||'').length>1500)throw Error('Keep each direction note within 1,500 characters.');
 const selectedParents=c.mode==='parent'?parents.filter(g=>g.id===c.parent_game_id):parents;
 if(!selectedParents.length)throw Error('A design choice references a removed parent.');
 const bundles=selectedParents.map(g=>{const b=bundlesFor(g)[d.id];return{game_id:g.id,label:b.label,component_ids:b.component_ids,evidence_status:b.evidence_status};});
 const bridge=c.mode==='bridge'?d.bridges.find(b=>b[0]===c.bridge_id):null;if(c.mode==='bridge'&&!bridge)throw Error('Choose an available bridge approach.');
 return{id:d.id,label:d.label,mode:c.mode,parent_game_id:c.mode==='parent'?c.parent_game_id:null,bridge:bridge?{id:bridge[0],label:bridge[1],status:'proposed'}:null,bundles,required_companions:d.requires,adaptation:(c.notes||'').trim(),implementation_status:'requested'};
 });
 if(design_choices.length>8)throw Error('Keep the brief to eight broad choices.');
 return{schema_version:2,kind:'gameverse_mashup_request',candidate_id:'workshop-mashup-draft',title:'Gameverse mashup build brief',runtime_target:'gba',intent:intent.trim(),parent_games:parents.map(g=>({game_id:g.id,title:g.name,rom_sha1:g.romSha1,ontology_path:g.ontologyPath||null})),foundation:{game_id:foundationId,preserve_world_and_campaign:true},design_choices,dependency_decisions:dependencyNotes(parents,choices,foundationId).map(n=>({...n,status:'requires_implementation_review'})),constraints:{target_platform:'gba',max_design_choices:8,original_or_permitted_assets:true},research_snapshot:{date:catalog.snapshotDate,source_commit:catalog.sourceCommit},status:'build_brief',notes:'A source-linked request for a native GBA build. No generated artifact, verified compatibility, or completed integration is implied.'};
}
