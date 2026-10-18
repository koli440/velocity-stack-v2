# Local RLS/RPC check for activity comments (see docs/comments.md, "SQL verification").
# Needs: pip install pgserver psycopg2-binary. Run from the repo root:
#   python scripts/sql-checks/comments/run.py
import pgserver, psycopg2, sys, uuid, os, tempfile, glob
HERE = os.path.dirname(os.path.abspath(__file__))
srv = pgserver.get_server(tempfile.mkdtemp(), cleanup_mode='delete')
uri = srv.get_uri()
c = psycopg2.connect(uri); c.autocommit=True; cur=c.cursor()
cur.execute(open(os.path.join(HERE, 'stub.sql')).read())
MIGS = ['20261204000000_activity_comments', '20261212000000_activity_comment_ui_rpcs',
        '20261214000000_activity_comment_moderation',
        '20261216000000_activity_mention_candidates_suggest',
        '20261217000000_mention_handles',
        '20261218000000_mention_candidates_fallback',
        '20261219000000_mention_candidates_real_first']
for m in MIGS:
    sql = open('supabase/migrations/%s.sql' % m).read()
    cur.execute(sql); cur.execute(sql)  # idempotent
print("migrations applied twice OK")
U={n:str(uuid.uuid4()) for n in ['owner','follower','stranger','coach','excoach','blocked','ghost']}
for n,i in U.items(): cur.execute("insert into profiles(id,nickname) values(%s,%s)",(i,n))
def A(vis):
    cur.execute("reset role")
    cur.execute("insert into activities(user_id,visibility) values(%s,%s) returning id",(U['owner'],vis)); return cur.fetchone()[0]
cur.execute("insert into follows values(%s,%s)",(U['follower'],U['owner']))
cur.execute("insert into coaching_relationships(coach_id,rider_id,status) values(%s,%s,'active'),(%s,%s,'ended')",(U['coach'],U['owner'],U['excoach'],U['owner']))
cur.execute("insert into blocks values(%s,%s)",(U['owner'],U['blocked']))
def me(n):
    cur.execute("reset role"); cur.execute("select set_config('app.uid',%s,false)",(U[n] if n else '',)); cur.execute("set role authenticated")
def q(sql,*a):
    cur.execute(sql,a); 
    try: return cur.fetchall()
    except psycopg2.ProgrammingError: return None
def tryq(sql,*a):
    try: cur.execute(sql,a); return 'OK'
    except Exception as e: return 'ERR: '+str(e).splitlines()[0]
def check(name,got,exp):
    print(('PASS' if got==exp else 'FAIL'),name,got if got!=exp else '')
    if got!=exp: check.f+=1
check.f=0
for vis in ['public','followers','private']:
    a=A(vis)
    exp={'public':{'owner':1,'follower':1,'stranger':1,'coach':1,'excoach':1,'blocked':0},
         'followers':{'owner':1,'follower':1,'stranger':0,'coach':1,'excoach':0,'blocked':0},
         'private':{'owner':1,'follower':0,'stranger':0,'coach':1,'excoach':0,'blocked':0}}[vis]
    for n,e in exp.items():
        me(n); r=tryq("select add_activity_comment(%s,%s)",a,'hi from '+n)
        check(f'{vis}: {n} can comment', r=='OK', bool(e))
    me('owner')
    check(f'{vis}: owner sees all', len(q("select 1 from activity_comments where activity_id=%s",a)), sum(exp.values())+0 if True else 0)
    for n in ['follower','stranger','coach','excoach','blocked']:
        me(n); check(f'{vis}: {n} reads {exp[n] and "all" or "none"}', len(q("select 1 from activity_comments where activity_id=%s",a))>0, bool(exp[n]))
    # retained when going private
cur.execute("reset role")
# visibility change retains comments
a=A('public'); me('follower'); q("select add_activity_comment(%s,'x')",a)
cur.execute("reset role"); cur.execute("update activities set visibility='private' where id=%s",(a,))
me('follower'); check('goes private: follower loses access', len(q("select 1 from activity_comments where activity_id=%s",a)),0)
me('owner'); check('goes private: owner retains', len(q("select 1 from activity_comments where activity_id=%s",a)),1)
me('coach'); check('goes private: coach retains', len(q("select 1 from activity_comments where activity_id=%s",a)),1)
# direct writes denied
me('owner'); check('direct insert denied', tryq("insert into activity_comments(activity_id,user_id,body) values(%s,%s,'x')",a,U['owner']).startswith('ERR'), True)
# comments disabled
a=A('public'); cur.execute("reset role"); cur.execute("update activities set comments_enabled=false where id=%s",(a,))
me('follower'); check('comments disabled blocks add', tryq("select add_activity_comment(%s,'x')",a).startswith('ERR'), True)
# edit/delete
a=A('public'); me('follower'); cid=q("select add_activity_comment(%s,'orig')",a)[0][0]
me('stranger'); check('stranger cannot edit', tryq("select edit_activity_comment(%s,'h')",cid).startswith('ERR'), True)
check('stranger cannot delete', tryq("select delete_activity_comment(%s)",cid).startswith('ERR'), True)
me('owner'); check('owner cannot edit others', tryq("select edit_activity_comment(%s,'h')",cid).startswith('ERR'), True)
me('follower'); check('author edits', tryq("select edit_activity_comment(%s,'new')",cid),'OK')
check('edited_at set', q("select edited_at is not null from activity_comments where id=%s",cid)[0][0], True)
check('author deletes', tryq("select delete_activity_comment(%s)",cid),'OK')
me('follower'); cid=q("select add_activity_comment(%s,'again')",a)[0][0]
me('owner'); check('owner deletes any', tryq("select delete_activity_comment(%s)",cid),'OK')
me('coach'); me('follower'); cid=q("select add_activity_comment(%s,'again')",a)[0][0]
me('coach'); check('coach cannot delete others', tryq("select delete_activity_comment(%s)",cid).startswith('ERR'), True)
# mentions
a=A('followers'); cur.execute("reset role")
cur.execute("delete from notifications")
me('owner'); cid=q("select add_activity_comment(%s,%s)",a,'hey @follower and @stranger and @blocked and @Coach, @owner')[0][0]
cur.execute("reset role")
m=sorted(r[0] for r in q("select p.nickname from activity_comment_mentions m join profiles p on p.id=m.user_id where comment_id=%s",cid))
check('mentions only visible non-self users', m, ['coach','follower'])
n=sorted(r for r in q("select p.nickname,type from notifications n join profiles p on p.id=n.user_id where n.comment_id=%s",cid))
check('mention notifications', n, [('coach','comment_mention'),('follower','comment_mention')])
# dedupe
cur.execute("delete from notifications")
a=A('public')
me('follower'); q("select add_activity_comment(%s,'1')",a); q("select add_activity_comment(%s,'2')",a); q("select add_activity_comment(%s,'3')",a)
cur.execute("reset role")
check('owner 1 unread notif', q("select count(*) from notifications where user_id=%s and type='activity_comment' and read_at is null",U['owner'])[0][0],1)
check('coach 1 unread notif', q("select count(*) from notifications where user_id=%s and type='activity_comment' and read_at is null",U['coach'])[0][0],1)
check('author no self notif', q("select count(*) from notifications where user_id=%s",U['follower'])[0][0],0)
check('excoach/blocked no notif', q("select count(*) from notifications where user_id in (%s,%s)",U['excoach'],U['blocked'])[0][0],0)
me('stranger'); q("select add_activity_comment(%s,'s')",a); cur.execute("reset role")
check('earlier commenter notified', q("select count(*) from notifications where user_id=%s and type='activity_comment'",U['follower'])[0][0],1)
cur.execute("update notifications set read_at=now() where user_id=%s",(U['owner'],))
me('follower'); q("select add_activity_comment(%s,'4')",a); cur.execute("reset role")
check('new unread after read', q("select count(*) from notifications where user_id=%s and type='activity_comment'",U['owner'])[0][0],2)
# rate limit
cur.execute("delete from activity_comment_log"); 
a=A('public'); me('stranger'); ok=0
for i in range(32):
    if tryq("select add_activity_comment(%s,%s)",a,f'rl{i}')=='OK': ok+=1
check('rate limit 30/hour', ok, 30)
# deleting doesn't reset
cur.execute("reset role"); cur.execute("delete from activity_comments where user_id=%s",(U['stranger'],)); me('stranger')
check('delete does not reset limit', tryq("select add_activity_comment(%s,'z')",a).startswith('ERR'), True)
# anon denied
cur.execute("reset role"); cur.execute("set role anon"); check('anon denied', tryq("select add_activity_comment(%s,'z')",a).startswith('ERR'), True)

a=A('followers'); cur.execute("reset role")
cur.execute("insert into profiles(id,nickname) values(gen_random_uuid(),'fol_two'),(gen_random_uuid(),'has space'),(gen_random_uuid(),'🚴')")
cur.execute("insert into follows select id,%s from profiles where nickname in ('fol_two','has space')",(U['owner'],))
me('owner'); check('candidates prefix', sorted(r[1] for r in q("select * from activity_mention_candidates(%s,'fo')",a)), ['fol_two','follower'])
check('candidates exclude stranger/blocked', [r[1] for r in q("select * from activity_mention_candidates(%s,'s')",a)], [])
check('nickname with space is mentionable as handle', [r[4] for r in q("select * from activity_mention_candidates(%s,'has')",a)], ['hasspace'])
check('emoji-only nickname never offered', [r[1] for r in q("select * from activity_mention_candidates(%s,'')",a) if r[1]=='🚴'], [])
check('candidates wildcard safe', q("select * from activity_mention_candidates(%s,'%%')",a), [])
me('stranger'); check('candidates hidden activity', q("select * from activity_mention_candidates(%s,'f')",a), [])
me('coach'); check('coach gets candidates', len(q("select * from activity_mention_candidates(%s,'o')",a))>0, True)
cur.execute("reset role"); cur.execute("insert into profiles(id,nickname,is_bot) select gen_random_uuid(),'aa_bot'||g,true from generate_series(1,12) g")
cur.execute("insert into follows select id,%s from profiles where is_bot",(U['owner'],))
me('follower'); r=[x[1] for x in q("select * from activity_mention_candidates(%s,'')",a)]
check('real riders outrank bots; unfollowed bots hidden on bare @', [n for n in r if n.startswith('aa_bot')], [])
me('follower'); check('typing finds bots after real riders', [x[1] for x in q("select * from activity_mention_candidates(%s,'aa_')",a)][:1], ['aa_bot1'])
me('owner'); q("select add_activity_comment(%s,'hi @hasspace!')",a)
cur.execute('reset role'); check('free-text nickname is mentioned via handle', q("select count(*) from activity_comment_mentions m join profiles p on p.id=m.user_id where p.nickname='has space'")[0][0], 1)
me('follower'); check('bare @ (follower): owner, coach first, then other visible riders', [r[1] for r in q("select * from activity_mention_candidates(%s,'')",a)], ['owner','coach','fol_two','has space'])
me('coach'); check('bare @ (coach): owner (athlete)', [r[1] for r in q("select * from activity_mention_candidates(%s,'')",a)], ['owner','fol_two','follower','has space'])
me('owner'); check('bare @ (owner): coach first, never empty', [r[1] for r in q("select * from activity_mention_candidates(%s,'')",a)], ['coach','fol_two','follower','has space'])
me('stranger'); check('bare @ hidden activity', q("select * from activity_mention_candidates(%s,'')",a), [])
me('blocked'); check('bare @ blocked', q("select * from activity_mention_candidates(%s,'')",a), [])
me('excoach'); check('bare @ ex-coach', q("select * from activity_mention_candidates(%s,'')",a), [])
me('owner'); pub=A('public'); me('follower'); q("select add_activity_comment(%s,'x')",pub)
r=q("select owner_id,comments_enabled,comment_count,coach_id,viewer_is_coach from activity_comment_info(array[%s::uuid,%s::uuid])",pub,a)
check('info rows (public visible, followers visible to follower)', len(r),2)
me('coach'); r=q("select viewer_is_coach,coach_id from activity_comment_info(array[%s::uuid])",pub); check('info coach flag', r,[(True,U['coach'])])
me('stranger'); check('info hides unseen activity', len(q("select * from activity_comment_info(array[%s::uuid])",a)),0)
me('blocked'); check('info hides from blocked', len(q("select * from activity_comment_info(array[%s::uuid])",pub)),0)

cur.execute("reset role"); cur.execute("update profiles set is_admin=true where nickname='ghost'")
pub=A('public'); me('follower'); cid=q("select add_activity_comment(%s,E'a\\u202Eb\\u0007c\\u200Bd\\ne')",pub)[0][0]
cur.execute("reset role"); check('control chars stripped', q("select body from activity_comments where id=%s",cid)[0][0],'abcd\ne')
me('stranger'); check('report ok', tryq("select report_activity_comment(%s,'spam')",cid),'OK'); check('report twice idempotent', tryq("select report_activity_comment(%s,'spam')",cid),'OK')
me('follower'); check('cannot report own', tryq("select report_activity_comment(%s)",cid).startswith('ERR'),True)
me('blocked'); check('blocked cannot report', tryq("select report_activity_comment(%s)",cid).startswith('ERR'),True)
me('stranger'); check('non-admin cannot list', tryq("select * from admin_list_comment_reports()").startswith('ERR'),True)
cur.execute("reset role"); check('one report row', q("select count(*) from comment_reports")[0][0],1)
me('ghost'); rows=q("select id,status,body_snapshot from admin_list_comment_reports()"); check('admin lists', [(r[1],r[2]) for r in rows],[('open','abcd\ne')])
check('admin removes', tryq("select admin_resolve_comment_report(%s,true)",rows[0][0]),'OK')
cur.execute("reset role"); check('comment deleted + report removed', (q("select count(*) from activity_comments where id=%s",cid)[0][0], q("select status from comment_reports")[0][0]),(0,'removed'))
# blocks hide comments both ways
cur.execute('reset role'); cur.execute('delete from activity_comment_log'); pub=A('public'); me('stranger'); q("select add_activity_comment(%s,'from stranger')",pub); me('follower'); q("select add_activity_comment(%s,'from follower')",pub)
cur.execute("reset role"); cur.execute("insert into blocks values(%s,%s)",(U['stranger'],U['follower']))
me('follower'); check('blocked side hides comment', [r[0] for r in q("select body from activity_comments where activity_id=%s",pub)],['from follower'])
me('stranger'); check('blocker hides too', [r[0] for r in q("select body from activity_comments where activity_id=%s",pub)],['from stranger'])
check('count respects block', q("select comment_count from activity_comment_info(array[%s::uuid])",pub)[0][0],1)
me('owner'); check('owner sees both', len(q("select 1 from activity_comments where activity_id=%s",pub)),2)
print('FAILURES',check.f)
