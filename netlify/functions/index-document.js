const {createClient}=require("@supabase/supabase-js");
const pdfParse=require("pdf-parse");
const mammoth=require("mammoth");

exports.handler=async(event)=>{
 if(event.httpMethod!=="POST")return json(405,{error:"Method not allowed"});
 if(!process.env.OPENAI_API_KEY||!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY||!process.env.SUPABASE_SERVICE_ROLE_KEY)return json(503,{error:"Indexing service is not configured."});
 const token=(event.headers.authorization||"").replace(/^Bearer\s+/i,"");if(!token)return json(401,{error:"Please sign in first."});
 const userClient=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{global:{headers:{Authorization:"Bearer "+token}}});
 const {data:userData,error:userError}=await userClient.auth.getUser(token);if(userError||!userData.user)return json(401,{error:"Your session is invalid or expired."});
 let body;try{body=JSON.parse(event.body||"{}")}catch{return json(400,{error:"Invalid JSON"})}
 const path=String(body.storagePath||"");const fileName=String(body.fileName||"");const moduleCode=String(body.moduleCode||"").trim().toUpperCase();
 if(!path||!fileName||!path.startsWith(userData.user.id+"/"))return json(400,{error:"Invalid document path."});
 if(!/\.(pdf|docx|txt|md)$/i.test(fileName))return json(400,{error:"Supported files are PDF, DOCX, TXT and MD."});
 const admin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
 const download=await admin.storage.from("tmj-documents").download(path);if(download.error)return json(404,{error:"Uploaded document could not be read."});
 const buffer=Buffer.from(await download.data.arrayBuffer());let text="";
 try{
   if(/\.pdf$/i.test(fileName)){const parsed=await pdfParse(buffer);text=parsed.text}
   else if(/\.docx$/i.test(fileName)){const parsed=await mammoth.extractRawText({buffer});text=parsed.value}
   else text=buffer.toString("utf8");
 }catch(e){return json(422,{error:"The document could not be extracted. Try a text-based PDF or DOCX."})}
 text=text.replace(/\s+/g," ").trim();if(text.length<30)return json(422,{error:"No usable text was found in the document."});
 const chunks=chunkText(text,1800,250);if(chunks.length>250)return json(413,{error:"Document is too large for one indexing operation. Split it into smaller files."});
 const {data:doc,error:docError}=await admin.from("documents").insert({user_id:userData.user.id,file_name:fileName,storage_path:path,module_code:moduleCode||null,source_type:"student_upload"}).select("id").single();
 if(docError)return json(500,{error:"Could not register the document: "+docError.message});
 const embeddings=[];
 for(const chunk of chunks){const emb=await embed(chunk);if(!emb.ok)return json(emb.status,{error:emb.error});embeddings.push(emb.embedding)}
 const rows=chunks.map((content,i)=>({document_id:doc.id,user_id:userData.user.id,chunk_index:i,content,embedding:embeddings[i]}));
 const {error:chunkError}=await admin.from("document_chunks").insert(rows);if(chunkError)return json(500,{error:"Could not save document embeddings: "+chunkError.message});
 return json(200,{ok:true,message:"Document indexed successfully. TMJ AI can now use it for your academic questions.",chunks:chunks.length});
};
function chunkText(text,size,overlap){const out=[];let start=0;while(start<text.length){const end=Math.min(text.length,start+size);out.push(text.slice(start,end));if(end===text.length)break;start=end-overlap}return out}
async function embed(input){const r=await fetch("https://api.openai.com/v1/embeddings",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+process.env.OPENAI_API_KEY},body:JSON.stringify({model:process.env.OPENAI_EMBEDDING_MODEL||"text-embedding-3-small",input})});const d=await r.json();if(!r.ok)return{ok:false,status:r.status,error:d.error?.message||"Embedding failed"};return{ok:true,embedding:d.data[0].embedding}}
function json(status,body){return{statusCode:status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)}}
