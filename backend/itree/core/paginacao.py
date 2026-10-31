from rest_framework.pagination import PageNumberPagination


class Paginacao(PageNumberPagination):
    page_size = 50
    page_size_query_param = "tamanho"
    max_page_size = 500
    page_query_param = "pagina"
