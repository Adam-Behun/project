def parse_query(query):
    if 'books by' in query:
        author_name = query.split('books by')[-1].strip()
        return f"SELECT * FROM books WHERE author = '{author_name}'"
    return ""

def get_data(sql_query):
    conn = sqlite3.connect('data/mydatavase.db')
    cur = conn.cursor()
    cur.execute(sql_query)
    results = cur.fetchall()
    conn.close()
    return results

query = input("What are you looking for")
sql_query = parse_query(query)
if sql_query:
    results = get_data(sql_query)
    print("Results: ", results)
else:
    print("Query not understood")