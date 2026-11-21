# Rumo do produto: decisões de 21/11/2026

Doze lacunas foram fechadas numa rodada de perguntas com a pessoa responsável pelo
produto. Estas decisões valem até serem revistas e atualizam `pendentes.md`.

| # | Tema | Decisão | Efeito no iTree |
| --- | --- | --- | --- |
| 1 | Inventário (DP-18) | Não há inventário oficial a importar. A base virá de pesquisas existentes e, principalmente, de **outro projeto que detecta árvores em vídeo de carros e em imagens de satélite**. | É preciso criar a entrada de **detecção automática**. A importação de bases legadas continua valendo para levantamentos existentes. |
| 2 | Conteúdo da detecção | Posição, confiança, foto ou recorte, espécie sugerida e medidas estimadas. Sugerido também: ids de detecção e de rastreamento, versão do modelo, data e hora, origem (veículo, câmera ou satélite), incerteza da posição em metros, polígono da copa, várias vistas, contexto (calçada, canteiro, praça, lote privado), interferências (fiação, poste, fachada, calçada), sinais de risco, berço vazio ou toco, mudança entre passagens, qualidade da imagem. Rostos e placas chegam **já borrados** (LGPD). | Contrato de dados da detecção. |
| 3 | Integração | Ainda indefinida. Recomendado: API de recebimento no iTree (push, com token), com pacote de arquivos (GeoPackage e fotos em ZIP) como alternativa. | O iTree define o contrato e o outro projeto se adapta. |
| 4 | Entrada no inventário | A detecção **entra direto**, com o selo de confiança (baixa, média ou alta) e a origem ("via satélite" ou "via vídeo de rua"). A inspeção de campo ou a revisão humana promove a árvore a "confirmada". | Novas detecções da mesma árvore viram observações dela, não árvores novas. |
| 5 | Indicadores | Mostrar **as duas contagens**: total e confirmadas, com filtro. | Vale para ficha do bairro, Análises, "Onde plantar" e visão geral. |
| 6 | Hospedagem (DP-21) | **Só demonstração** por enquanto; o piloto fica para depois. | Nenhum trabalho de implantação neste momento. |
| 7 | Público-alvo | **Pesquisa e ONG**. | Ênfase em análise, reprodutibilidade e citação das fontes. |
| 8 | Objetivos | **Desigualdade verde**, **inventário aberto** e **monitoramento de mudanças**. | Priorização dos próximos ciclos. |
| 9 | Abertura | **Nada público** por enquanto; tudo com login. | O painel público fica fora do escopo atual. |
| 10 | Método dos indicadores (DP-14) | Adotar a **regra 3-30-300**: 3 árvores visíveis de cada casa, 30% de cobertura de copa no bairro, área verde a até 300 m. | Os indicadores 3-30-300 substituem o selo "provisório" onde se aplicarem, com método e fonte declarados. |
| 11 | Módulos de operação | **Tudo visível**. A ideia é que coletivos ou a prefeitura façam as atividades (tarefas, equipes, ocorrências, inspeções), talvez de forma comunitária. | Nenhum módulo é ocultado. Uso comunitário fica como hipótese a explorar. |
| 12 | UrbVerde | **Ligar** a gravação dos valores por bairro (`URBVERDE_GRAVAR_VALORES`), em uso acadêmico e não comercial, com citação da fonte. | Habilita a ilha de calor na ficha do bairro e no "Onde plantar". |
