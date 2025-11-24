-- Query utili per visualizzare i media in Supabase

-- 1. VIEW per visualizzare tutti i messaggi con media in modo leggibile
CREATE OR REPLACE VIEW messages_with_media AS
SELECT
  id,
  phone_number,
  message,
  status,
  session_id,
  created_at,
  metadata->>'mediaType' AS media_type,
  metadata->>'mediaEmoji' AS emoji,
  metadata->>'fileName' AS file_name,
  metadata->>'filePath' AS file_path,
  metadata->>'mimeType' AS mime_type,
  (metadata->>'fileSize')::bigint AS file_size_bytes,
  CASE
    WHEN (metadata->>'fileSize')::bigint < 1024 THEN (metadata->>'fileSize')::text || ' B'
    WHEN (metadata->>'fileSize')::bigint < 1048576 THEN ROUND((metadata->>'fileSize')::numeric / 1024, 2)::text || ' KB'
    WHEN (metadata->>'fileSize')::bigint < 1073741824 THEN ROUND((metadata->>'fileSize')::numeric / 1048576, 2)::text || ' MB'
    ELSE ROUND((metadata->>'fileSize')::numeric / 1073741824, 2)::text || ' GB'
  END AS file_size_readable,
  (metadata->>'fromMe')::boolean AS from_me
FROM messages
WHERE metadata->>'mediaType' IS NOT NULL
  AND metadata->>'mediaType' != 'text'
ORDER BY created_at DESC;

-- 2. Indice per query veloci sui media
CREATE INDEX IF NOT EXISTS idx_messages_media_type ON messages USING GIN ((metadata->'mediaType'));

-- 3. Query: Tutti i media ricevuti (foto, video, audio, documenti)
-- SELECT * FROM messages_with_media WHERE from_me = false;

-- 4. Query: Tutti i media inviati
-- SELECT * FROM messages_with_media WHERE from_me = true;

-- 5. Query: Solo foto
-- SELECT * FROM messages_with_media WHERE media_type = 'image';

-- 6. Query: Solo video
-- SELECT * FROM messages_with_media WHERE media_type = 'video';

-- 7. Query: Solo audio/vocali
-- SELECT * FROM messages_with_media WHERE media_type = 'audio';

-- 8. Query: Solo documenti
-- SELECT * FROM messages_with_media WHERE media_type = 'document';

-- 9. Query: Totale media per tipo
SELECT
  metadata->>'mediaType' AS media_type,
  COUNT(*) AS count,
  SUM((metadata->>'fileSize')::bigint) AS total_size_bytes,
  CASE
    WHEN SUM((metadata->>'fileSize')::bigint) < 1048576
      THEN ROUND(SUM((metadata->>'fileSize')::numeric) / 1024, 2)::text || ' KB'
    WHEN SUM((metadata->>'fileSize')::bigint) < 1073741824
      THEN ROUND(SUM((metadata->>'fileSize')::numeric) / 1048576, 2)::text || ' MB'
    ELSE ROUND(SUM((metadata->>'fileSize')::numeric) / 1073741824, 2)::text || ' GB'
  END AS total_size_readable
FROM messages
WHERE metadata->>'mediaType' IS NOT NULL
  AND metadata->>'mediaType' != 'text'
GROUP BY metadata->>'mediaType'
ORDER BY count DESC;

-- 10. Query: Media ricevuti nelle ultime 24 ore
SELECT * FROM messages_with_media
WHERE from_me = false
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- 11. Query: Statistiche media per contatto
SELECT
  phone_number,
  COUNT(*) FILTER (WHERE metadata->>'mediaType' = 'image') AS photos,
  COUNT(*) FILTER (WHERE metadata->>'mediaType' = 'video') AS videos,
  COUNT(*) FILTER (WHERE metadata->>'mediaType' = 'audio') AS audios,
  COUNT(*) FILTER (WHERE metadata->>'mediaType' = 'document') AS documents,
  COUNT(*) AS total_media
FROM messages
WHERE metadata->>'mediaType' IS NOT NULL
  AND metadata->>'mediaType' != 'text'
GROUP BY phone_number
ORDER BY total_media DESC;
