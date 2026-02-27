import pymysql

conn = pymysql.connect(
    host='localhost',
    user='root',
    password='9487',
    database='pdf_summary',
    charset='utf8mb4'
)
cursor = conn.cursor()

# 각 테이블의 전체 구조 확인 (CREATE TABLE 문 포함)
tables = ['users', 'user_sessions', 'admin_activity_logs', 'pdf_documents']

for table in tables:
    print(f'\n' + '='*80)
    print(f'테이블: {table}')
    print('='*80)
    cursor.execute(f'SHOW CREATE TABLE {table}')
    result = cursor.fetchone()
    print(result[1])

cursor.close()
conn.close()
