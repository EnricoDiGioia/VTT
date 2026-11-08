// ⚙️ Configuração do projeto Firebase "MesaVTT".
// Essas chaves podem ficar públicas: quem protege os dados são as regras do Realtime Database.
// Para voltar ao "modo local" (só abas do mesmo navegador), troque o objeto por null.
export const firebaseConfig = {
  apiKey: "AIzaSyDcwjKy4XhCzgF7A39BTQvfvMDrFPX3Wgk",
  authDomain: "mesavtt.firebaseapp.com",
  databaseURL: "https://mesavtt-default-rtdb.firebaseio.com",
  projectId: "mesavtt",
  storageBucket: "mesavtt.firebasestorage.app",
  messagingSenderId: "701365250677",
  appId: "1:701365250677:web:cc19acb78fd4cab68ce63c",
};

// Endereços do Froq que podem abrir a Mesa dentro da aba Atividades (?froq=<endereço>).
// Aberta por um deles, a Mesa usa a conta e o servidor do Froq no lugar do Firebase.
export const froqOrigins = [
  'https://froq.onrender.com',
  'http://localhost:5173', // npm run dev do Froq
  'http://localhost:5174', // testes de ponta a ponta do Froq
];
