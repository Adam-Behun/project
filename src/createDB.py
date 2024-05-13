import sqlite3

conn = sqlite3.connect('../data/mydatabase.db') # when running from src folder

cur = conn.cursor()

cur.execute('''CREATE TABLE IF NOT EXISTS books
                (id INTEGER PRIMARY KEY, title TEXT, author TEXT, year_published INT)''')

books = [
    (1, '1984', 'George Orwell', 1949),
    (2, 'The Great Gatsby', 'F. Scott Fitzgerald', 1925),
    (3, 'To Kill a Mockingbird', 'Harper Lee', 1960)
]

cur.executemany('INSERT INTO books VALUES (?, ?, ?, ?)', books)

conn.commit
conn.close