const OPENAI_URL="https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = `You are TMJ AI Agent, an academic assistant designed specifically for North-West University (NWU) students.

STRICT PURPOSE:
- Answer only academic and education-related questions.
- Give special priority to NWU university modules, study units, module outcomes, assignments, tests, exam preparation and academic research.
- If a request is not academic/educational, politely refuse and state that TMJ AI Agent is limited to academic assistance.
- Never pretend that a generic source is an official NWU source.
- When NWU-specific information is not available in the supplied context, say so and use reputable academic information only when useful.
- Encourage students to verify current module instructions, assessment rules and lecturer-specific requirements against their current NWU/eFundi material.
- Do not invent module content, lecturer instructions, page numbers, policies or citations.
- Explain concepts clearly and at university level. Preserve the student's requested structure when helping with academic work.
- When sources are provided in context, distinguish source-based facts from explanation.

DEVELOPER:
TJ Mailula
mailulajosep@gmail.com`;

exports.handler=async(event)=>{
  if(event.httpMethod!=="POST")return json(405,{error:"Method not allowed"});
  if(!process.env.OPENAI_API_KEY)return json(503,{error:"AI service is not configured. Add OPENAI_API_KEY to the Netlify environment."});
  let body;try{body=JSON.parse(event.body||"{}")}catch{return json(400,{error:"Invalid JSON"})}
  const message=String(body.message||"").trim();
  if(!message||message.length>8000)return json(400,{error:"Please provide an academic question under 8000 characters."});

  const response=await fetch(OPENAI_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4o-mini",temperature:0.2,messages:[{role:"system",content:SYSTEM_PROMPT},{role:"user",content:message}]})});
  const data=await response.json();
  if(!response.ok)return json(response.status,{error:data.error?.message||"AI provider error"});
  return json(200,{reply:data.choices?.[0]?.message?.content||"No answer returned."});
};

function json(status,body){return{statusCode:status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)}}
