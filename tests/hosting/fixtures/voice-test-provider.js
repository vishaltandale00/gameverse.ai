// Explicit test-only injection, never imported by production Worker entrypoint.
export async function scriptedVoiceProvider({kind,payload}){
 if(kind==='transcribe')return {text:'Play soccer and try to score'};
 if(kind==='plan')return {provider:'scripted',model:'no-model',answers:[{name:'intent',type:'choice',choice:'start'},{name:'target',type:'choice',choice:'soccer'},{name:'selection',type:'choice',choice:'reuse'},{name:'second_run',type:'predicate',probability:0}]};
 if(kind==='decisions')return {provider:'scripted',model:'no-model',answers:payload.questions.map(q=>({name:q.name,type:'choice',choice:q.name==='move'?(q.choices.find(c=>/east|right/.test(c.value))||q.choices.find(c=>c.value!=='stop')||q.choices[0]).value:(q.choices.find(c=>c.value==='move')||q.choices.find(c=>c.value==='release')||q.choices[0]).value}))};
 if(kind==='reflect')return {text:'Keep playing toward the goal.',model:'no-model'};
 throw Error('unsupported scripted provider operation');
}
