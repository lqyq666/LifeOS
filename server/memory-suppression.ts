const SQL_ALIAS=/^[A-Za-z_][A-Za-z0-9_]*$/
export const scopedMemorySuppressionKind='scope_marker'

// New exact memory controls retain the original key tombstone so extraction
// cannot recreate the fact, and pair it with this marker plus an exact quote in
// growth_source_suppressions. Rows created before this marker existed keep
// their conservative full-message privacy meaning.
export const scopedMemorySuppressionKey=(key:string)=>'scope:'+key

export function fullMemorySuppressionSql(alias:string){
  if(!SQL_ALIAS.test(alias))throw new Error('MEMORY_SUPPRESSION_SQL_ALIAS_INVALID')
  return `${alias}.suppression_kind='fact'
    AND ${alias}.key NOT LIKE 'pattern:%'
    AND NOT EXISTS (
      SELECT 1 FROM memory_suppressions memory_scope
      WHERE memory_scope.user_id=${alias}.user_id
        AND memory_scope.source_conversation_id=${alias}.source_conversation_id
        AND memory_scope.source_message_id=${alias}.source_message_id
        AND memory_scope.suppression_kind='${scopedMemorySuppressionKind}'
        AND memory_scope.key='scope:'||${alias}.key
    )`
}
