import {readFileSync,writeFileSync} from 'node:fs'
const core=JSON.parse(readFileSync('tests/fixtures/workflow-local-trajectories.json','utf8'))
core[0].guide='first-contact';core[0].category='就业实习';core[1].category='自由职业';core[2].category='创业';core[3].category='考研'
// Predeclared user words, including incomplete profiles and corrections; no generated state flags.
const extra=`
indie|独立开发|校园工具开发|prototype-test|我想试着做校园工具，但还没决定功能，怎么找最小实验？|先保留为探索。|我愿意试这个方法。|我已经做了一个表单，同学点开了但有没有使用我不知道。|我更正，点开不等于采用，采用仍然未知。|这周课程优先，我只剩两小时。|我现在不想继续扩大功能，先停在这里。
recommendation|保研|科研兴趣与保研|experience-evidence|我不知道自己适不适合研究，想先整理课程项目经历，怎么做？|先区分愿望和贡献。|我愿意试这个方法。|我已经整理了课程实验，我本人负责记录数据，没有独立设计实验。|我更正，小组报告不是我独立完成的。|本周只剩一小时，我先保住课程。|我不想现在判断保研资格，先不要给准备建议。
public|考公考编|公共部门工作探索|direction-comparison|我没想清楚工作方向，想比较公共部门和企业的日常，怎么核对？|工作日常和资格仍未知。|我愿意先了解，不代表已经决定报考。|我已经读了一个岗位介绍，但具体工作强度仍不知道。|我更正，那是朋友的工作经历，不是我做过。|下周我只有两小时能了解情况。|我现在不想继续这条探索，不要再推考公。
overseas|留学|留学项目投入核对|application-match|家里还没明确预算，我想知道申请项目是否值得，怎么先核对要求？|预算未知不等于不可行。|我愿意先看一个项目，不代表决定申请。|我已经保存了项目介绍，但费用和适用条件没核实。|我更正，拿到录取的是朋友，不是我。|本周只剩半小时，先不扩大材料准备。|我不想继续留学准备了，这条先暂停。
cross|跨专业|新领域任务探索|skill-gap|原专业让我没感觉，想转到新领域，怎么核对作品缺口？|先核对一个真实任务。|我愿意试一个小作品。|我已经写了一个脚本，但目标岗位是否需要它还不知道。|我更正，脚本里模板是公开示例，我只改了输入部分。|这周剩一小时，课程还是重点。|我不想继续加课，先停下这个建议。
media|自媒体|校园内容小实验|content-experiment|想写给同学看的内容，可是不知道读者需要什么，怎么小范围试？|读者需要尚未确认。|我愿意试一篇，不等于长期方向。|我已经写了第一篇，朋友看过，是否帮到别人不知道。|我更正，没有实际读者反馈，朋友只说看到了。|下周有两小时，先不追播放量。|我现在不想继续发布，只想说说压力。
income|兼职收入|兼职收支记录|income-ledger|兼职到账和支出混了，我想弄清可用预算，怎么整理？|实际到账与预期分开。|我愿意先记已经到账的部分。|我已经做完一次兼职，但这笔钱还没收到。|我更正，之前说的收入是预期款，不是已到账。|这周只剩半小时，我先核对这一笔。|我不想再接新的兼职，先不要推荐。
research|科研|陌生论文阅读|research-reading|刚接触科研好多词不懂，读一篇陌生论文怎么开始？|读过摘要不算读完。|我愿意先看摘要的问题。|我已经看完摘要，方法部分还没有理解。|我更正，那个实验是论文作者做的，不是我做的。|本周只有一小时，先找一个未知术语。|我不想继续做复现了，先保留阅读记录。
contest|竞赛社团|竞赛协作任务|team-contract|社团想组队比赛，具体任务总不清楚，怎么分工？|加入团队不等于完成项目。|我愿意先核对本人负责部分。|我已经写了展示页，数据还在等队友，比赛结果未知。|我更正，队友完成的后端不是我的贡献。|这周有两小时，我只接续展示页。|我不想再接队友的额外任务，先停止建议。
volunteer|公益|公益活动协作|team-contract|想做公益但不知道自己能负责什么，怎样先确认任务？|愿望与实际参与分开。|我愿意先联系活动负责人。|我已经写了报名说明，是否被采用还不知道。|我更正，活动还没有举行，不能写成已服务别人。|这周只剩一小时，我不承诺更多任务。|我不想继续参与这次活动，请尊重这个选择。
balance|生活平衡|课程休息与探索|priority-budget|最近课程和课外事挤一起，我想守住休息，怎么安排？|先核对硬节点和实际余量。|我愿意缩小这周安排。|我没有开始原来的探索，材料还没找到。|我更正，每周六小时是常规预算，这周只剩一小时。|这周零小时可用，我先休息，不要新增行动。|下周有两小时，但我仍然不想继续原来的探索。
undecided|方向未定|从迷茫开始的探索|fit-exploration|我不知道想做什么，不想先填完整档案，能有什么小尝试？|无需完整档案即可开始。|我愿意先了解一个真实工作任务。|我已经读了任务说明，但还没亲自做过。|我更正，看过介绍不是实践经历。|这周只剩半小时，我想先保留未知。|我现在不想选方向了，只想聊聊。
`.trim().split('\n').map(x=>x.split('|'))
const added=extra.map(([id,category,title,guide,first,reply,...texts])=>({id,category,title,guide,rounds:[{session:0,text:first,reply,kinds:['goal'],expectGrowth:first.split(/[，。]/)[0]},...texts.map((text,i)=>({session:Math.floor((i+1)/2),text,reply:['先保存本人当前选择，尚未执行。','保留实际尝试和仍未知的反馈。','只根据本人更正修订理解，其他贡献不扩大。','当前约束优先，旧预算不代替本周余量。','尊重暂停或拒绝，后续不重复推动。'][i],...(i===0?{kinds:['preference']}:{})}))]}))
const all=[...core,...added];const volunteer:any=all.find(c=>c.id==='volunteer')!.rounds[0];delete volunteer.expectGrowth;volunteer.expectNoGrowth=true;volunteer.expectationCorrection='Original overbroad question-as-goal label corrected; actual request remains in event, initial failure retained.';if(all.length!==16||all.some(x=>x.rounds.length!==6)||new Set(all.map(x=>x.category)).size!==16)throw new Error('STUDENT_COHORT_INVALID')
writeFileSync('tests/fixtures/workflow-student16.json',JSON.stringify({schemaVersion:1,expectationsFrozenBeforeExecution:true,evidenceKind:'LOCAL_SCRIPTED_NOT_MODEL_QUALITY',students:all},null,2)+'\n')
