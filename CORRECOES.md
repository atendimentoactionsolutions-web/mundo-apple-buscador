# Revisão da plataforma

Correções aplicadas no projeto local, com testes isolados dos dados reais.

- Catálogo vazio ou indisponível deixa de mostrar carregamento infinito; respostas vazias removem ofertas antigas.
- Cache separado por usuário e inicialização após a validação da sessão e das margens.
- Respostas antigas de requisições simultâneas deixam de substituir o catálogo mais recente.
- Margens particulares são preservadas nas atualizações em tempo real. Eventos públicos não carregam margens confidenciais.
- Cálculo compartilhado entre simulador, orçamento e servidor, preservando centavos e validando quantidades, descontos e taxas.
- Valores totais e parcelas são recalculados no servidor ao salvar uma proposta.
- Orçamentos e estatísticas separados por loja. Administradores mantêm a visão geral.
- Sessões bloqueadas, vencidas e encerradas deixam de acessar APIs autenticadas. Logout também encerra o socket correspondente.
- Erros assíncronos nas rotas recebem uma resposta HTTP, em vez de deixar solicitações penduradas.
- Arquivos de usuários e orçamentos danificados não são substituídos por dados vazios. Escritas de configuração e usuários usam arquivos temporários.
- Busca do orçamento usa a mesma referência de preços da vitrine, aceita IDs numéricos e preserva RAM e condição do aparelho.
- Digitação de descontos mantém o foco. Quantidades respeitam o limite de 99 unidades.
- Margens armazenadas como texto são convertidas corretamente; seminovos recebem a margem correspondente à sua condição.
- Histórico indisponível não apresenta preços de hoje como se fossem de outra data.
- Data padrão da proposta usa o dia local do navegador.
- PDF reserva espaço para o resumo e aplica rodapé e numeração a todas as páginas.
- Falha na conexão inicial com o PXT mantém o catálogo salvo e agenda recuperação.
- Dependências vulneráveis atualizadas com versões compatíveis; correção explícita de `qs`.

## Validação

Execute `npm test` para testar o frontend completo em ambiente simulado, APIs HTTP, Socket.IO, preços, gravação/reabertura de propostas e geração de PDFs.

Execute `npm audit --omit=dev` para consultar a auditoria das dependências.

Os testes usam diretórios temporários e não modificam clientes, senhas ou orçamentos reais.

## Configuração para publicação

As credenciais externas foram removidas do código atual e preservadas no arquivo `.env` local, ignorado pelo Git. Ao publicar em outro servidor, configure `PXT_EMAIL` e `PXT_PASSWORD`, ou `PXT_AUTH_TOKEN`, conforme `.env.example`.

Uma instalação nova, sem administrador cadastrado, exige `BOOTSTRAP_ADMIN_PASSWORD` com pelo menos 12 caracteres. Contas existentes mantêm suas senhas.

Credenciais presentes em versões antigas do Git continuam no histórico; esta revisão não reescreveu o histórico nem alterou senhas no serviço externo.

Esta revisão verifica os cenários cobertos pelos testes. A conferência visual no navegador, o ambiente publicado e a integração real com o PXT ainda precisam ser validados nesses ambientes.
