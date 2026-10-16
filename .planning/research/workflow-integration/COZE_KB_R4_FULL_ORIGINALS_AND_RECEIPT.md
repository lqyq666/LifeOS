# LIFEOS_KB_R4_FULL_ORIGINALS_AND_RECEIPT

原公共资料项目7693465311558795327内独立执行，预留25000既有开发积分，产品模型/发布/新项目/预算新增0。R3原报告保留不覆盖。主端核对发现：IES/CFPB仅读附着引用而未独立读正文不能成为正式源审核；campus声称的 /tmp/kb_batch32/orig_0.txt 实际不存在。不是要求改措辞标PASS，请补真实原文执行证据。

已附真实原站完整HTML与两份原始PDF（仅公共资料，无私库/学生/Key），你必须逐字核对其bytes SHA，再独立读取全文上下文（HTML去script/style/noscript后body text，PDF逐页），然后审6张当前稿：campus v3，IES4张v3，income v4。income新增spending第1页Analyze your spending的按类别/周操作句，旧“仅envelope不足”结论保留。官方原站GET失败保留；可以明确使用已下载原站原字节工件完成独立原文阅读，不宣称这次独立HTTP成功。已下载原件是原文，主端提炼的短引用/boolean不是。

请产出 assets/kb_original_card_review_r4.json，固定结构如下（字段不是自证明，需要实际生成/读取工件与记录）：

kind=INDEPENDENT_ORIGINAL_CARD_REVIEW，execution={projectId:'7693465311558795327',sessionId:'363941496948738',taskId:'LIFEOS_KB_R4_FULL_ORIGINALS_AND_RECEIPT',startedAt,finishedAt,executor:'actual-independent-coze-project'}。
originals数组：每项{sourceId,sourceRevision,canonicalUrl,boundSourceFingerprint,artifactPath,artifactBytesSha256,normalizedTextPath,normalizedTextSha256,normalization,acquisition:'HASH_VERIFIED_DOWNLOADED_ORIGINAL_FULL_BODY_READ',readAt}。artifactPath指你项目内实际原文件，normalizedTextPath是项目内实际保存的规范全文文本，PDF分page保存各页规范全文文本，文件哈希须可在实际终端再次核对。不可把主端short quote拼成正文。
cards数组：{guideId,revision,contentHash,decision:'ready_for_owner_approval'或'needs_review'或'reject',notes,claimChecks:[{claimId,basis,decision:'supported'或'supported_as_editorial'或'insufficient',reason,evidenceChecks:[{evidenceId,sourceId,sourceRevision,quote,quoteSha256,normalizedTextPath,start,end,pageNumber?}]}]}。

source_supported的每项必须有真实全文读取与短引用定位；editorial需要具体范围/拒绝/失败/未知审核，不用外部引文证明自设计行动效果。完整原文可读却仍不足时保持needs_review，不能只看source_supported标签。每张claimIds完整、无重复，对应精确guideId/revision/contentHash；不由主生成者改哈希。最少一张可审稿能形成原文/执行/版本绑定的独立建议供正常维护入口等待本人批准，不是真人批准，不发布。library原文只证明该校图书馆教育/资源实操，不推该校权限迁移他校；IES方法不证明已掌握或通用最优间隔；CFPB只普适教育记录，不中国具体规则/资金结果/整体兼职价值。

所有原文件、规范全文、报告持久化assets/review-originals-r4及提交。返回实际commit、报告+每份规范全文SHA与路径。保留R1/R2/R3失败/不可达/未知与所有实际费用，0产品调用，不修改治理，不直接批准/发布。若有源或草稿变化请给具体结论与未满足项。
