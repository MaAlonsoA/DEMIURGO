// Errores de dominio. Los mensajes van en español y en lenguaje de producto.

export const ESTADO_HTTP = {
  no_autenticado: 401,
  prohibido: 403,
  no_encontrado: 404,
  transicion_invalida: 409,
  guarda: 409,
  conflicto: 409,
  validacion: 422,
  no_implementado: 501,
} as const;

export type TipoError = keyof typeof ESTADO_HTTP;

export class ErrorDominio extends Error {
  readonly tipo: TipoError;
  readonly motivos: readonly string[];

  constructor(tipo: TipoError, mensaje: string, motivos: readonly string[] = []) {
    super(mensaje);
    this.name = 'ErrorDominio';
    this.tipo = tipo;
    this.motivos = motivos;
  }

  get estadoHttp(): number {
    return ESTADO_HTTP[this.tipo];
  }
}

export function esErrorDominio(e: unknown): e is ErrorDominio {
  return e instanceof ErrorDominio;
}
