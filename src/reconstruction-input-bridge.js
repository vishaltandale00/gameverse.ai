// Authored interface adapter around the recovered Dragon Ball input function.
// The host supplies that function; this module never substitutes authored edges.
export const DB_DRIV_INPUT_BRIDGE = Object.freeze({
 id:'db-input-to-driv-input-service/1', sourceGame:'dragon-ball-advanced-adventure',targetGame:'driv3r',
 sourcePackageId:'db.input.actor_edges_repeat',sourcePrefabId:'db.actor-input.sample-edges-repeat',
 targetPhaseId:'input-capture',scope:'Replace one invocation of Driv3r input sampling; publish canonical held and newly pressed low-ten button masks.',
 sourceBehaviorSha256:'de55633a24564cfb1777638a695821dc41351f287a03cb9ec68c40e95a93ddac',
 status:'implemented-host-adapter',readyToAdd:false,runtimeQualified:false,sourceFaithful:false,
 requiredServices:['Qualified recovered db.input.actor_edges_repeat invocation','Canonical Driv3r held/pressed backing','One raw KEYINPUT u16 sample at each original 08004d08 invocation'],
 missingServices:['Live Driv3r invocation bridge and 08004dd4 consumer execution','Pause/resampling boundary qualification'],
 evidence:['ontology/executable-components/db.input.actor_edges_repeat.json','research/deep-extraction/resume/driv3r/system-prefab/input-sampling.source.c','research/deep-extraction/resume/driv3r/system-prefab/input-sampling.original.asm.txt','research/deep-extraction/resume/driv3r/system-prefab/loop-schedule.original.asm.txt'],
 mappings:[{from:'raw KEYINPUT',to:'field_6',operation:'(~raw)&0x3ff'},{from:'canonical held0203ab3e',to:'field_2',operation:'retain previous held before invocation'},{from:'field_2',to:'canonical held0203ab3e',operation:'u16 identity after invocation'},{from:'field_3',to:'canonical pressed0203ab3c',operation:'u16 identity; never export field_5 repeat'}],
 eventOrder:['capture original input-service boundary','normalize active-low hardware mask','invoke recovered DB behavior once','publish held and pressed together','original 08004dd4 consumer (external)'],
});
const u16 = (value,name) => {if(!Number.isInteger(value)||value<0||value>65535)throw Error(`${name} must be u16.`);return value;};
export function createDrivInputBridge(canonical, invokeRecovered) {
 if(!canonical||typeof invokeRecovered!=='function')throw Error('Canonical input backing and recovered invocation service are required.');
 u16(canonical.held,'held');u16(canonical.pressed,'pressed');
 const auxiliary={field_0:0,field_1:16,field_4:0,field_5:0};
 return {step(rawKeyInput){
   u16(rawKeyInput,'KEYINPUT');
   const state={...auxiliary,field_2:u16(canonical.held,'held'),field_3:u16(canonical.pressed,'pressed'),field_6:(~rawKeyInput)&0x3ff};
   // Synchronous service completion is required before publication/consumer entry.
   const result=invokeRecovered(state);
   if(result&&typeof result.then==='function')throw Error('Recovered input invocation must complete synchronously.');
   const held=u16(state.field_2,'recovered held'),pressed=u16(state.field_3,'recovered pressed');
   if(held>1023||pressed>1023)throw Error('Recovered input escaped the low-ten button domain.');
   for(const key of ['field_1','field_4','field_5'])auxiliary[key]=state[key];
   canonical.held=held;canonical.pressed=pressed;
   return {held,pressed};
 }};
}
