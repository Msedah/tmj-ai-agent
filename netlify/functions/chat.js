const {createClient}=require("@supabase/supabase-js");
const OPENAI_URL="https://api.openai.com/v1/chat/completions";
const SYSTEM_PROMPT=`You are TMJ AI Agent, an academic assistant designed specifically for North-West University (NWU) students.

STRICT PURPOSE:
- Answer only academic and education-related questions.
- Give special priority to NWU university modules, study units, assignments, tests, exam preparation and academic research.
- If a request is not academic/educational, politely refuse and state that TMJ AI Agent is limited to academic assistance.
- Retrieved documents are evidence. Prioritise current NWU official material and the student's uploaded module material for module-specific questions.
- Never call a student upload an official NWU source unless its metadata says it is an official NWU source.
- Do not invent module content, lecturer instructions, page numbers, policies or citations.
- If the supplied documents do not answer an NWU-specific question, say that the available NWU material does not establish the answer.
- Give source notes at the end using the provided source labels.
- Explain concepts clearly at university level.

DEVELOPER: TJ Mailula | mailulajosep@gmail.com`;

exports.handler=async(event)=>{
 if(event.httpMethod!=="POST")return json(405,{error:"Method not allowed"});
 if(!process.env.OPENAI_API_KEY||!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY)return json(503,{error:"AI/database service is not configured."});
 const token=(event.headers.authorization||"").replace(/^Bearer\s+/i,"");if(!token)return json(401,{error:"Please sign in first."});
 const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}});
 const {data:userData,error:userError}=await supabase.auth.getUser(token);if(userError||!userData.user)return json(401,{error:"Your session is invalid or expired."});
 let body;try{body=JSON.parse(event.body||"{}")}catch{return json(400,{error:"Invalid JSON"})}
 const message=String(body.message||"").trim();if(!message||message.length>8000)return json(400,{error:"Please provide an academic question under 8000 characters."});

 const emb=await openaiEmbed(message);if(!emb.ok)return json(emb.status,{error:emb.error});
 const {data:chunks,error:chunkError}=await supabase.rpc("match_document_chunks",{query_embedding:emb.embedding,match_user_id:userData.user.id,match_count:8});
 if(chunkError)return json(500,{error:"Knowledge search failed. Check the Supabase vector function."});
 const selected=(chunks||[]).filter(x=>x.similarity>=0.25);
 const context=selected.map((x,i)=>"[Source "+(i+1)+": "+x.source_name+(x.module_code?" | Module "+x.module_code:"")+(x.source_url?" | "+x.source_url:"")+"]\n"+x.content).join("\n\n");
 const prompt="RETRIEVED ACADEMIC CONTEXT:\n"+(context||"No matching uploaded material was found.")+"\n\nSTUDENT QUESTION:\n"+message;
 const response=await fetch(OPENAI_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4o-mini",temperature:0.2,messages:[{role:"system",content:SYSTEM_PROMPT},{role:"user",content:prompt}]})});
 const data=await response.json();if(!response.ok)return json(response.status,{error:data.error?.message||"AI provider error"});
 const reply=data.choices?.[0]?.message?.content||"No answer returned.";
 let conversationId=body.conversationId||null;
 if(conversationId){const {data:c}=await supabase.from("conversations").select("id").eq("id",conversationId).maybeSingle();if(!c)conversationId=null}
 if(!conversationId){const title=message.length>70?message.slice(0,67)+"…":message;const {data:c,error}=await supabase.from("conversations").insert({user_id:userData.user.id,title}).select("id").single();if(error)return json(500,{error:"Answer generated, but conversation could not be saved."});conversationId=c.id}
 const saved=await supabase.from("messages").insert([{conversation_id:conversationId,user_id:userData.user.id,role:"user",content:message},{conversation_id:conversationId,user_id:userData.user.id,role:"assistant",content:reply}]);
 if(saved.error)return json(500,{error:"Answer generated, but the conversation could not be saved."});
 return json(200,{reply,conversationId,sources:selected.slice(0,5).map(x=>({name:x.source_name,module:x.module_code,type:x.source_type,url:x.source_url}))});
};
async function openaiEmbed(input){const r=await fetch("https://api.openai.com/v1/embeddings",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.OPENAI_API_KEY},body:JSON.stringify({model:process.env.OPENAI_EMBEDDING_MODEL||"text-embedding-3-small",input})});const d=await r.json();if(!r.ok)return{ok:false,status:r.status,error:d.error?.message||"Embedding failed"};return{ok:true,embedding:d.data[0].embedding}}
function json(status,body){return{statusCode:status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)}}