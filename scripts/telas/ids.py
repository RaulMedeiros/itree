"""Imprime os identificadores usados por capturar.js (executar com manage shell)."""
import json
from itree.inventario.models import Arvore
from itree.evidencias.models import Evidencia
from itree.qualidade.models import InferenciaIA
from itree.inspecoes.models import Inspecao
from itree.ocorrencias.models import Ocorrencia
from itree.alertas.models import AlertaAmbiental as Alerta
from itree.contas.models import Usuario
ev = Evidencia.objects.filter(estado="disponivel").order_by("criado_em").first()
insp = Inspecao.objects.filter(estado="em_revisao").order_by("-recebida_em").first()
oco = Ocorrencia.objects.filter(estado="em_atendimento", risco_confirmado=True).first() or Ocorrencia.objects.filter(estado="em_atendimento").first()
arv = insp.arvore
print(json.dumps({"arvore_foto": str(ev.arvore_id or "") if ev else "", "arvore": str(arv.id), "lon": arv.geom.x, "lat": arv.geom.y,
 "arvore_ia": str(InferenciaIA.objects.first().arvore_id), "inspecao": str(insp.id), "ocorrencia": str(oco.id),
 "alerta": str(Alerta.objects.order_by("numero").first().id), "usuario": str(Usuario.objects.get(email="clara.campos@itree.local").id)}))
