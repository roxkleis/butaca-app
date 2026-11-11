# Butaca

Butaca permite buscar películas y series, consultar sus puntuaciones y ver en qué plataformas están disponibles en Argentina. [Abrir Butaca](https://butaca-personal.pages.dev/).

## Vista previa local

Desde esta carpeta, ejecutá `node preview.mjs` con Node.js 24 y abrí [Butaca](http://127.0.0.1:4310/). Buscá *VisionQuest* en **Series**.

La vista local cruza los archivos oficiales de episodios y puntuaciones de IMDb por identificador de episodio. Los archivos se descargan a la carpeta temporal y se renuevan cada 24 horas. La primera consulta puede demorar mientras se descargan. Los episodios recientes pueden aparecer sin nota hasta la próxima actualización. [Archivos de IMDb para uso personal](https://data.imdb.com/non-commercial-datasets/).

Para verificar el código del servidor, ejecutá `node --test`.

## Cloudflare Pages

El directorio **public** contiene la interfaz recuperada y la función que consulta las puntuaciones de IMDb por temporada vía OMDb. Configurá `OMDB_API_KEY` como secreto del entorno de vista previa en **butaca-personal**, y cargá **public** en ese entorno con **Direct Upload**. La clave se usa en el servidor. Probá el gráfico en la vista previa con la clave real antes de promover el cambio. [Clave de OMDb](https://www.omdbapi.com/apikey.aspx), [carga directa en Pages](https://developers.cloudflare.com/pages/get-started/direct-upload/).

El código original de las funciones de búsqueda, fichas y disponibilidad no estaba disponible. El nuevo despliegue depende de que se conserve el despliegue `b96bba2f`, al que delega esas consultas. Podés revertir la actualización desde el historial de Cloudflare Pages. [Despliegue de referencia](https://b96bba2f.butaca-personal.pages.dev), [reversión en Pages](https://developers.cloudflare.com/pages/configuration/rollbacks/).
