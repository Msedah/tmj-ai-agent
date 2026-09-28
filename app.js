const CONFIG={supabaseUrl:"YOUR_SUPABASE_URL",supabaseAnonKey:"YOUR_SUPABASE_ANON_KEY"};let supabase=null;let session=null;let currentConversation=null;let authMode="signin";const $=id=>document.getElementById(id);

function ready(){if(CONFIG.supabaseUrl.startsWith("YOUR_")){console.warn("Configure Supabase in app.js before enabling accounts.");return}supabase=window.supabase.createClient(CONFIG.supabaseUrl,CONFIG.supabaseAnonKey);supabase.auth.onAuthStateChange((_event,newSession)=>{session=newSession;updateAuthUI();loadConversations()});supabase.auth.getSession().then(({data})=>{session=data.session;updateAuthUI();loadConversations()})}

function updateAuthUI(){ $("authButton").textContent=session?"Sign out":"Sign in"; $("newChat").disabled=!session; if(session){$("conversationList").innerHTML='<p class="muted">Loading...</p>'} }

$("authButton").addEventListener("click",async()=>{if(session){await supabase.auth.signOut();return}$("authDialog").showModal()});
$("authToggle").addEventListener("click",()=>{authMode=authMode==="signin"?"signup":"signin";$("authTitle").textContent=authMode==="signin"?"Sign in":"Create account";$("authSubmit").textContent=authMode==="signin"?"Sign in":"Create account";$("authName").hidden=authMode==="signin";$("authPassword").autocomplete=authMode==="signin"?"current-password":"new-password";});
$("authForm").addEventListener("submit",async e=>{e.preventDefault();if(!supabase){$("authStatus").textContent="Account services are not configured yet.";return}const email=$("authEmail").value.trim(),password=$("authPassword").value,name=$("authName").value.trim();$("authStatus").textContent="";let result;if(authMode==="signin")result=await supabase.auth.signInWithPassword({email,password});else result=await supabase.auth.signUp({email,password,options:{data:{full_name:name}}});if(result.error)$("authStatus").textContent=result.error.message;else $("authDialog").close()});

$("newChat").addEventListener("click",()=>{currentConversation=null;$("messages").innerHTML='<div class="welcome"><p class="eyebrow">NEW CONVERSATION</p><h2>What are you studying?</h2></div>'});

$("chatForm").addEventListener("submit",async e=>{e.preventDefault();const prompt=$("prompt").value.trim();if(!prompt)return;addMessage("user",prompt);$("prompt").value="";const thinking=addMessage("assistant","Thinking…");try{const response=await fetch("/.netlify/functions/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:prompt,conversationId:currentConversation?.id||null})});const data=await response.json();thinking.textContent=data.reply||data.error||"No response received.";if(data.conversationId)currentConversation={id:data.conversationId}}catch(err){thinking.textContent="The agent could not connect. Please try again."}});

function addMessage(role,text){const el=document.createElement("div");el.className="message "+role;el.textContent=text;$("messages").appendChild(el);$("messages").scrollTop=$("messages").scrollHeight;return el}

async function loadConversations(){if(!supabase||!session)return;const {data,error}=await supabase.from("conversations").select("id,title,updated_at").order("updated_at",{ascending:false}).limit(30);if(error){$("conversationList").innerHTML='<p class="muted">Could not load conversations.</p>';return}$("conversationList").innerHTML="";for(const c of data){const el=document.createElement("div");el.className="conversation";el.textContent=c.title||"New conversation";el.onclick=()=>loadConversation(c.id);$("conversationList").appendChild(el)}if(!data.length)$("conversationList").innerHTML='<p class="muted">No saved conversations yet.</p>'}

async function loadConversation(id){if(!supabase||!session)return;const {data}=await supabase.from("messages").select("role,content").eq("conversation_id",id).order("created_at",{ascending:true});currentConversation={id};$("messages").innerHTML="";(data||[]).forEach(m=>addMessage(m.role,m.content))}

ready();
