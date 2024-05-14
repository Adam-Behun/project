# Text to SQL project

- I would like to build a little project which would connect a llm to a database and then I would be able to ask questions in English and the llm would translate that into a query and retrieve relevant information from the database. 


## Alpha version = Alpha branch
- The overall goal is to ask a question in a console and get the llm to translate my question into SQL statement, retrieve data, and give me an answer. 
- use local sqlite with sample data
- develop small local LLM

## Beta version

User Interface: simple web-based interface where users can type their queries.

Language Processing: The application uses TensorFlow to interpret the natural language queries and transform them into SQL queries.

Database Interaction: The application executes SQL queries against a SQLite database and retrieves the data.

Response Generation: The language model formats the retrieved data into understandable responses, which are then presented to the user.

Hosting: The final application is hosted online